use core::ops::Range;

use bun_core::strings::{self, CodeUnits};
use bun_core::vec::BorrowedBuf;
use bun_paths::PathChar;

use crate::normalize_string::normalize_string;
use crate::{
    BACKSLASH, COLON, CodeUnit, DOT, JoinedSize, Origin, Output, ParsedRanges, PathArgs, Relative,
    ResolveStep, Result, SLASH, Scratch, append_joined, byte_at, dot_segment_len,
    last_index_of_sep_in, len_without_trailing_sep, scan, to_utf16_in, unicode, without_suffix,
};

const WIN32: bool = true;
const QUESTION_MARK: u8 = b'?';
pub(crate) const DRIVE_LEN: usize = "C:".len();
const DRIVE_ROOT_LEN: usize = r"C:\".len();
const DEVICE_PREFIX_LEN: usize = r"\\?\".len();
const UNC_SERVER_START: usize = r"\\".len();

#[inline(always)]
pub(crate) fn is_sep_at<U: CodeUnit>(path: &[U], index: usize) -> bool {
    matches!(byte_at(path, index), SLASH | BACKSLASH)
}

#[inline(always)]
pub(crate) fn has_drive<U: CodeUnit>(path: &[U]) -> bool {
    byte_at(path, 1) == COLON && path[0].to_u8_saturating().is_ascii_alphabetic()
}

#[inline(always)]
fn drive_len<U: CodeUnit>(path: &[U]) -> usize {
    if has_drive(path) { DRIVE_LEN } else { 0 }
}

#[inline(always)]
fn has_drive_and_backslash<U: CodeUnit>(path: &[U]) -> bool {
    has_drive(path) && byte_at(path, DRIVE_LEN) == BACKSLASH
}

enum Root {
    None,
    /// `\`, or `\\` without a server and a share after it.
    Rooted,
    /// `C:` or `C:\`.
    Drive {
        is_absolute: bool,
    },
    /// `\\server\share`, `\\.\name` or `\\?\name`.
    UncOrDevice {
        server: Range<usize>,
        share: Range<usize>,
    },
}

impl Root {
    #[inline(always)]
    fn parse<U: CodeUnit>(path: &[U]) -> Root {
        if has_drive(path) {
            Root::Drive {
                is_absolute: is_sep_at(path, DRIVE_LEN),
            }
        } else if !is_sep_at(path, 0) {
            Root::None
        } else if !is_sep_at(path, 1) {
            Root::Rooted
        } else {
            Root::parse_unc(path)
        }
    }

    #[inline(never)]
    fn parse_unc<U: CodeUnit>(path: &[U]) -> Root {
        let segment_at = |start: usize| {
            let len = scan::index_of_slash_or_backslash(&path[start..]);
            start..len.map_or(path.len(), |len| start + len)
        };
        let server = segment_at(UNC_SERVER_START);
        let is_server_name = !server.is_empty()
            && dot_segment_len::<U, BACKSLASH>(&path[server.clone()]) != "..".len();
        match path[server.end..]
            .iter()
            .position(|&unit| !crate::is_sep::<U, WIN32>(unit))
        {
            Some(separators) if is_server_name => {
                let share = segment_at(server.end + separators);
                Root::UncOrDevice { server, share }
            }
            _ => Root::Rooted,
        }
    }
}

/// Whether `server` is the "." of `\\.\` or the "?" of `\\?\`.
#[inline(always)]
fn is_device_prefix<U: CodeUnit>(server: &[U]) -> bool {
    server.len() == 1 && matches!(server[0].to_u8_saturating(), DOT | QUESTION_MARK)
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L73-L84>
fn is_reserved_name<U: CodeUnit>(name: &[U]) -> bool {
    const SHORT_LEN: usize = "CON".len();
    const LONG_LEN: usize = "COM1".len();
    const SUPERSCRIPT_1: u8 = 0xB9;
    const SUPERSCRIPT_2: u8 = 0xB2;
    const SUPERSCRIPT_3: u8 = 0xB3;
    // `toUpperCase()` maps no character outside ASCII to one of these letters.
    let upper_at = |at: usize| byte_at(name, at).to_ascii_uppercase();
    match (name.len(), &[upper_at(0), upper_at(1), upper_at(2)]) {
        (SHORT_LEN, b"CON" | b"PRN" | b"AUX" | b"NUL") => true,
        (LONG_LEN, b"COM" | b"LPT") => matches!(
            byte_at(name, 3),
            b'1'..=b'9' | SUPERSCRIPT_1 | SUPERSCRIPT_2 | SUPERSCRIPT_3
        ),
        _ => false,
    }
}

#[inline(always)]
pub fn is_absolute<U: CodeUnit>(path: &[U]) -> bool {
    is_sep_at(path, 0) || (has_drive(path) && is_sep_at(path, DRIVE_LEN))
}

#[inline(always)]
pub fn basename<U: CodeUnit>(path: &[U]) -> Range<usize> {
    crate::basename::<U, WIN32>(path, drive_len(path))
}

#[inline(always)]
pub fn basename_without_suffix<U: CodeUnit, S: CodeUnit>(path: &[U], suffix: &[S]) -> Range<usize> {
    without_suffix(path, basename(path), suffix)
}

/// The `rootEnd` of `dirname` and `parse`: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L818-L869>
#[inline(always)]
fn root_end<U: CodeUnit>(path: &[U]) -> usize {
    match Root::parse(path) {
        Root::None => 0,
        Root::Rooted => 1,
        Root::Drive { is_absolute } => DRIVE_LEN + usize::from(is_absolute),
        Root::UncOrDevice { share, .. } => path.len().min(share.end + 1),
    }
}

/// The length of the prefix of `path` to return. `None` means ".".
#[inline(always)]
pub fn dirname<U: CodeUnit>(path: &[U]) -> Option<usize> {
    let root_end = root_end(path);
    let end = len_without_trailing_sep::<U, WIN32>(path, root_end);
    last_index_of_sep_in::<U, WIN32>(path, root_end..end)
        .or_else(|| (root_end != 0).then_some(root_end))
}

#[inline(always)]
pub fn extname<U: CodeUnit>(path: &[U]) -> Range<usize> {
    crate::extname::<U, WIN32>(path, drive_len(path))
}

#[inline(always)]
pub fn parse<U: CodeUnit>(path: &[U]) -> ParsedRanges {
    let root_end = root_end(path);
    crate::parse::<U, WIN32>(path, root_end, root_end)
}

#[inline(always)]
fn is_tidy<U: CodeUnit>(tail: &[U]) -> bool {
    dot_segment_len::<U, BACKSLASH>(tail) == 0
        && !scan::has_untidy_backslash_or_slash_or_colon(tail)
}

/// `true` implies `normalize(path) == path`.
#[inline(always)]
pub fn is_trivially_normalized<U: CodeUnit>(path: &[U]) -> bool {
    let is_drive_absolute = has_drive_and_backslash(path);
    !path.is_empty() && is_tidy(&path[if is_drive_absolute { DRIVE_LEN } else { 0 }..])
}

/// `true` implies `resolve(path) == path`.
#[inline(always)]
pub(crate) fn is_trivially_resolved<U: CodeUnit>(path: &[U]) -> bool {
    has_drive_and_backslash(path)
        && (path.len() == DRIVE_ROOT_LEN || !path[path.len() - 1].eq_ascii(BACKSLASH))
        && is_tidy(&path[DRIVE_LEN..])
}

#[inline(always)]
pub fn normalize<'s, U: CodeUnit>(path: &[U], scratch: &'s mut Scratch) -> Result<Output<'s>> {
    if path.is_empty() {
        return Ok(Output::DOT);
    }
    let mut buffer = scratch.buffer(path.len() + PADDING)?;
    buffer.unfilled().append(&DOT_PREFIX.map(U::from_u8));
    buffer.unfilled().append(path);
    let normalized = Padded::close(buffer).normalize();
    Ok(if normalized == path {
        Output::Arg(0)
    } else {
        Output::Built(U::units(normalized))
    })
}

pub(crate) const DOT_PREFIX: [u8; 2] = [DOT, BACKSLASH];
pub(crate) const PADDING: usize = DOT_PREFIX.len() + 1;

/// A non-empty path with room for [`DOT_PREFIX`] before it and for one unit after it.
pub(crate) struct Padded<'s, U>(&'s mut [U]);

impl<'s, U: CodeUnit> Padded<'s, U> {
    const START: usize = DOT_PREFIX.len();

    /// `buffer` holds [`DOT_PREFIX`] and the path.
    #[inline(always)]
    pub(crate) fn close(mut buffer: BorrowedBuf<'s, U>) -> Self {
        buffer.unfilled().append(&[U::from_u8(BACKSLASH)]);
        debug_assert!(buffer.len() > PADDING);
        Padded(buffer.into_filled_mut())
    }

    #[inline(always)]
    fn path(&self) -> &[U] {
        &self.0[Self::START..self.0.len() - 1]
    }

    /// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L350-L481>
    #[inline(never)]
    pub(crate) fn normalize(self) -> &'s [U] {
        let padded = self.0;
        let end = padded.len() - 1;
        let path = &mut padded[Self::START..end];
        strings::replace_char_in_place(path, SLASH, BACKSLASH);
        let len = path.len();
        if len == 1 {
            return path;
        }
        let has_trailing_sep = path[len - 1].eq_ascii(BACKSLASH);
        let backslash = U::from_u8(BACKSLASH);

        // The root is rewritten to `padded[start..tail_start]`.
        let (mut start, mut tail_start) = (Self::START, Self::START);
        let (mut is_absolute, mut has_root) = (true, true);
        match Root::parse(path) {
            Root::Rooted => tail_start += 1,
            Root::Drive {
                is_absolute: is_drive_absolute,
            } => {
                is_absolute = is_drive_absolute;
                tail_start += DRIVE_LEN + usize::from(is_drive_absolute);
            }
            Root::UncOrDevice { server, .. } if is_device_prefix(&path[server.clone()]) => {
                tail_start += DEVICE_PREFIX_LEN;
            }
            Root::UncOrDevice { server, share } => {
                let extra_seps = share.start - server.end - 1;
                path.copy_within(..server.end, extra_seps);
                start += extra_seps;
                tail_start += share.end;
                // This is the padding if nothing follows the share.
                padded[tail_start] = backslash;
                tail_start += 1;
            }
            Root::None => (is_absolute, has_root) = (false, false),
        }

        let tail = &mut padded[tail_start.min(end)..end];
        let mut written = tail_start + normalize_string::<U, BACKSLASH>(tail, None, !is_absolute);
        if written == tail_start && !is_absolute {
            padded[written] = U::from_u8(DOT);
            written += 1;
        }
        if written != tail_start && has_trailing_sep {
            padded[written] = backslash;
            written += 1;
        }
        if !has_root && needs_dot_prefix(&padded[Self::START..written]) {
            start = 0;
            padded[..Self::START].copy_from_slice(&DOT_PREFIX.map(U::from_u8));
        }
        &padded[start..written]
    }

    /// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L525-L566>
    #[inline(always)]
    pub(crate) fn collapse_leading_seps(self, first_part_len: usize) -> Self {
        let mut separators = 0;
        while is_sep_at(self.path(), separators) {
            separators += 1;
        }
        let first_part_is_unc = separators == UNC_SERVER_START && first_part_len > separators;
        if separators < 2 || first_part_is_unc {
            return self;
        }
        let padded = &mut self.0[separators - 1..];
        padded[Self::START] = U::from_u8(BACKSLASH);
        Padded(padded)
    }

    fn into_path(self) -> &'s [U] {
        &self.0[Self::START..self.0.len() - 1]
    }
}

/// `.\C:a`, `.\CON:a` and `.\ab:`. Only the result counts, so that the spellings of a path normalize alike.
#[inline(always)]
fn needs_dot_prefix<U: CodeUnit>(normalized: &[U]) -> bool {
    scan::index_of(normalized, COLON).is_some_and(|colon| {
        dot_segment_len::<U, BACKSLASH>(normalized) == 0
            && (has_drive(normalized)
                || is_reserved_name(&normalized[..colon])
                || has_colon_before_sep_or_end(&normalized[colon..]))
    })
}

fn has_colon_before_sep_or_end<U: CodeUnit>(path: &[U]) -> bool {
    scan::indices_of(path, COLON).any(|at| at + 1 == path.len() || path[at + 1].eq_ascii(BACKSLASH))
}

/// `None` if every path is empty: the result is ".", and `normalize` is not called.
pub fn join<'s, P: PathArgs>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Option<Output<'s>>, P::Error> {
    let size = JoinedSize::of_non_empty(paths)?;
    Ok(if size.len == 0 {
        None
    } else if size.is_16bit {
        let joined = concat_args(paths, size, scratch)?.normalize();
        Some(Output::Built(CodeUnits::U16(joined)))
    } else {
        let joined = concat_args(paths, size, scratch)?.normalize();
        Some(Output::Built(CodeUnits::U8(joined)))
    })
}

/// `join` up to its call of `normalize`: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L506-L566>
pub fn join_unnormalized<'s, P: PathArgs>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Output<'s>, P::Error> {
    let size = JoinedSize::of_non_empty(paths)?;
    Ok(if size.len == 0 {
        Output::DOT
    } else if size.is_16bit {
        let joined = concat_args(paths, size, scratch)?;
        Output::Built(CodeUnits::U16(joined.into_path()))
    } else {
        let joined = concat_args(paths, size, scratch)?;
        Output::Built(CodeUnits::U8(joined.into_path()))
    })
}

fn concat_args<'s, U: CodeUnit, P: PathArgs>(
    paths: P,
    size: JoinedSize,
    scratch: &'s mut Scratch,
) -> Result<Padded<'s, U>, P::Error> {
    let mut buffer = scratch.buffer(DOT_PREFIX.len() + size.len)?;
    buffer.unfilled().append(&DOT_PREFIX.map(U::from_u8));
    let first_len = append_joined(&mut buffer.unfilled(), paths, 0, BACKSLASH)?;
    Ok(Padded::close(buffer).collapse_leading_seps(first_len))
}

enum Device {
    None,
    Drive(u8),
    /// The "." or "?".
    DevicePrefix(u8),
    Unc {
        server: Range<usize>,
        share: Range<usize>,
    },
}

impl Device {
    /// `resolve` stops at a device that is not a drive, so only drives are ever compared.
    #[inline(always)]
    fn conflicts_with(&self, resolved: &Device) -> bool {
        match (self, resolved) {
            (Device::None, _) | (_, Device::None) => false,
            (Device::Drive(a), Device::Drive(b)) => !a.eq_ignore_ascii_case(b),
            _ => true,
        }
    }
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L233-L307>
struct RootAndTail<'p> {
    device: Device,
    is_absolute: bool,
    root: CodeUnits<'p>,
    tail: CodeUnits<'p>,
}

impl<'p> RootAndTail<'p> {
    #[inline(always)]
    fn parse(path: CodeUnits<'p>) -> Self {
        match_code_units!(path, |path| RootAndTail::parse_units(path))
    }

    #[inline(always)]
    fn parse_units<U: CodeUnit>(path: &'p [U]) -> Self {
        let (device, is_absolute, root_end) = match Root::parse(path) {
            Root::None => (Device::None, false, 0),
            Root::Rooted => (Device::None, true, 1),
            Root::Drive { is_absolute } => {
                (Device::Drive(byte_at(path, 0)), is_absolute, DRIVE_LEN)
            }
            Root::UncOrDevice { server, .. } if is_device_prefix(&path[server.clone()]) => {
                let device = Device::DevicePrefix(byte_at(path, server.start));
                (device, true, DEVICE_PREFIX_LEN)
            }
            Root::UncOrDevice { server, share } => {
                let root_end = share.end;
                (Device::Unc { server, share }, true, root_end)
            }
        };
        let (root, tail) = path.split_at(root_end);
        RootAndTail {
            device,
            is_absolute,
            root: U::units(root),
            tail: U::units(tail),
        }
    }
}

struct ResolveState<'p> {
    size: JoinedSize,
    device: Device,
    /// The argument that `device` was parsed from. `None`: the cwd.
    device_arg: Option<usize>,
    is_absolute: bool,
    /// The first argument whose tail is part of the result.
    first_arg: usize,
    cwd_tail: Option<CodeUnits<'p>>,
}

impl ResolveState<'_> {
    /// Returns the tail of `path` if it is part of the result: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L309-L330>
    #[inline(always)]
    fn accumulate<'p>(&mut self, path: CodeUnits<'p>, arg: Option<usize>) -> Option<CodeUnits<'p>> {
        let parsed = RootAndTail::parse(path);
        if parsed.device.conflicts_with(&self.device) {
            return None;
        }
        if let Device::None = self.device {
            self.device = parsed.device;
            self.device_arg = arg;
        }
        if self.is_absolute {
            self.size.add(parsed.root);
            return None;
        }
        self.size.add(path);
        self.is_absolute = parsed.is_absolute;
        Some(parsed.tail)
    }

    #[inline(always)]
    fn is_fully_qualified(&self) -> bool {
        self.is_absolute && !matches!(self.device, Device::None)
    }

    fn build<'s, U: CodeUnit, P: PathArgs>(
        &self,
        cwd: Option<CodeUnits<'_>>,
        paths: P,
        scratch: &'s mut Scratch,
    ) -> Result<&'s [U], P::Error> {
        let backslash = [U::from_u8(BACKSLASH)];
        let mut resolved = scratch.buffer(self.size.len + backslash.len())?;
        let mut to = resolved.unfilled();
        match self.device {
            Device::None => {}
            Device::Drive(letter) => to.append(&[letter, COLON].map(U::from_u8)),
            Device::DevicePrefix(mark) => to.append(&[BACKSLASH, BACKSLASH, mark].map(U::from_u8)),
            Device::Unc {
                ref server,
                ref share,
            } => {
                let arg = self.device_arg.map(|arg| paths.load(arg)).transpose()?;
                let path = arg.as_ref().map(P::units).or(cwd);
                let path = path.expect("the device was parsed from one of them");
                to.append(&backslash);
                for segment in [server, share] {
                    to.append(&backslash);
                    U::append(&mut to, path.slice(segment.clone()));
                }
            }
        }
        if self.is_absolute {
            to.append(&backslash);
        }
        let root_end = to.written();
        if let Some(cwd_tail) = self.cwd_tail {
            U::append(&mut to, cwd_tail);
            to.append(&backslash);
        }
        for index in self.first_arg..paths.len() {
            let path = paths.load(index)?;
            let parsed = RootAndTail::parse(P::units(&path));
            let is_on_device =
                self.device_arg == Some(index) || !parsed.device.conflicts_with(&self.device);
            if is_on_device && !parsed.tail.is_empty() {
                U::append(&mut to, parsed.tail);
                to.append(&backslash);
            }
        }
        let resolved = resolved.into_filled_mut();
        Ok(resolve_in_place(resolved, root_end, self.is_absolute))
    }
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L190-L344>
#[inline(never)]
pub fn resolve<'s, P: PathArgs>(
    cwd: Option<CodeUnits<'_>>,
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<ResolveStep<Output<'s>>, P::Error> {
    let mut state = ResolveState {
        size: JoinedSize::default(),
        device: Device::None,
        device_arg: None,
        is_absolute: false,
        first_arg: paths.len(),
        cwd_tail: None,
    };
    for index in (0..paths.len()).rev() {
        let path = paths.load(index)?;
        let path = P::units(&path);
        if path.is_empty() {
            continue;
        }
        if state.size.len == 0 && match_code_units!(path, |path| is_trivially_resolved(path)) {
            return Ok(ResolveStep::Done(Output::Arg(index)));
        }
        if state.accumulate(path, Some(index)).is_some() {
            state.first_arg = index;
        }
        if state.is_fully_qualified() {
            break;
        }
    }
    if !state.is_fully_qualified() {
        match (cwd, &state.device) {
            (None, &Device::Drive(letter)) => return Ok(ResolveStep::NeedsDriveCwd(letter)),
            (None, _) => return Ok(ResolveStep::NeedsCwd),
            (Some(cwd), &Device::Drive(letter))
                if match_code_units!(cwd, |cwd| is_on_other_drive(cwd, letter)) =>
            {
                state.is_absolute = true;
            }
            (Some(cwd), _) => state.cwd_tail = state.accumulate(cwd, None),
        }
    }
    Ok(ResolveStep::Done(Output::Built(if state.size.is_16bit {
        CodeUnits::U16(state.build(cwd, paths, scratch)?)
    } else {
        CodeUnits::U8(state.build(cwd, paths, scratch)?)
    })))
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L223-L230>
fn is_on_other_drive<U: CodeUnit>(cwd: &[U], letter: u8) -> bool {
    if byte_at(cwd, DRIVE_LEN) != BACKSLASH {
        return false;
    }
    let first = match u32::from(cwd[0].into()) {
        unicode::KELVIN_SIGN => b'k',
        _ => byte_at(cwd, 0),
    };
    !cwd[1].eq_ascii(COLON) || !first.eq_ignore_ascii_case(&letter)
}

/// Leaves `path[..root_end]` as it is.
#[inline(never)]
fn resolve_in_place<U: CodeUnit>(path: &mut [U], root_end: usize, is_absolute: bool) -> &[U] {
    debug_assert!(!path.is_empty());
    let tail = &mut path[root_end..];
    strings::replace_char_in_place(tail, SLASH, BACKSLASH);
    let mut end = root_end + normalize_string::<U, BACKSLASH>(tail, None, !is_absolute);
    if end == 0 {
        path[0] = U::from_u8(DOT);
        end = 1;
    }
    &path[..end]
}

#[inline(always)]
pub(crate) fn resolve_drive_absolute_in_place(path: &mut [u8]) -> &[u8] {
    let is_absolute = true;
    path[DRIVE_LEN] = BACKSLASH;
    resolve_in_place(path, DRIVE_ROOT_LEN, is_absolute)
}

/// `process.cwd()` outside Windows: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L210-L212>
pub fn cwd_from_posix<'s, U: CodeUnit>(cwd: &[U], scratch: &'s mut Scratch) -> Result<&'s [U]> {
    let cwd = scratch.copy_of(cwd)?;
    strings::replace_char_in_place(cwd, SLASH, BACKSLASH);
    Ok(cwd)
}

/// The environment variable `=C:`.
#[cfg(windows)]
pub fn drive_cwd(letter: u8) -> Option<Vec<u16>> {
    let name = [b'=', letter, COLON, 0].map(u16::from);
    bun_sys::windows::getenv_w(bun_core::WStr::from_slice_with_nul(&name))
}

#[cfg(not(windows))]
pub fn drive_cwd(letter: u8) -> Option<Vec<u16>> {
    let name = [b'=', letter, COLON, 0];
    let value = bun_core::getenv_z(bun_core::ZStr::from_slice_with_nul(&name))?;
    strings::to_utf16_alloc_for_real(value, false, false).ok()
}

/// `None` if either needs a cwd.
pub fn relative<'s>(
    from: CodeUnits<'_>,
    to: CodeUnits<'s>,
    scratch: &'s mut Scratch,
) -> Result<Option<Output<'s>>> {
    let mut from_scratch = Scratch::new();
    let Some((from, _)) = resolve_without_cwd(from, &mut from_scratch)? else {
        return Ok(None);
    };
    let Some((to, origin)) = resolve_without_cwd(to, scratch)? else {
        return Ok(None);
    };
    let relative = relative_code_units(from, to)?;
    Ok(Some(relative.into_output(BACKSLASH, to, origin)))
}

fn resolve_without_cwd<'s>(
    path: CodeUnits<'s>,
    scratch: &'s mut Scratch,
) -> Result<Option<(CodeUnits<'s>, Origin)>> {
    Ok(match resolve(None, &[path][..], scratch)? {
        ResolveStep::Done(Output::Built(resolved)) => Some((resolved, Origin::Scratch)),
        ResolveStep::Done(_) => Some((path, Origin::Arg)),
        ResolveStep::NeedsCwd | ResolveStep::NeedsDriveCwd(_) => None,
    })
}

/// `relative` after its calls of `resolve`. A script can replace `resolve`, so the arguments can be any text.
pub fn relative_of_resolved<'s>(from: CodeUnits<'_>, to: CodeUnits<'s>) -> Result<Output<'s>> {
    Ok(relative_code_units(from, to)?.into_output(BACKSLASH, to, Origin::Arg))
}

fn relative_code_units(from: CodeUnits<'_>, to: CodeUnits<'_>) -> Result<Relative> {
    if let (CodeUnits::U8(from), CodeUnits::U8(to)) = (from, to) {
        return Ok(relative_latin1(from, to));
    }
    let (mut from_scratch, mut to_scratch) = (Scratch::new(), Scratch::new());
    relative_utf16(
        to_utf16_in(from, &mut from_scratch)?,
        to_utf16_in(to, &mut to_scratch)?,
    )
}

#[inline(never)]
pub(crate) fn relative_latin1(from: &[u8], to: &[u8]) -> Relative {
    relative_units(from, to, |from, to| {
        let mut common = 0;
        loop {
            common += scan::common_prefix_length(&from[common..], &to[common..]);
            let pairs = from[common..].iter().zip(&to[common..]);
            let differing_in_case = pairs.take_while(|&(&a, &b)| {
                a != b && unicode::to_lower_latin1(a) == unicode::to_lower_latin1(b)
            });
            match differing_in_case.count() {
                0 => return common,
                count => common += count,
            }
        }
    })
}

fn relative_utf16(from: &[u16], to: &[u16]) -> Result<Relative> {
    let (mut from_scratch, mut to_scratch) = (Scratch::new(), Scratch::new());
    let lower_from = unicode::to_lower_case(from, &mut from_scratch)?;
    let lower_to = unicode::to_lower_case(to, &mut to_scratch)?;
    Ok(
        if lower_from.len() == from.len() && lower_to.len() == to.len() {
            relative_units(lower_from, lower_to, scan::common_prefix_length)
        } else {
            relative_by_segments(lower_from, lower_to, to)
        },
    )
}

#[inline(always)]
fn trim_backslashes<U: CodeUnit>(path: &[U]) -> Range<usize> {
    let leading = path.iter().take_while(|unit| unit.eq_ascii(BACKSLASH));
    let start = leading.count();
    let mut end = path.len();
    while end > start + 1 && path[end - 1].eq_ascii(BACKSLASH) {
        end -= 1;
    }
    start..end
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L665-L761>
#[inline(always)]
fn relative_units<U: CodeUnit>(
    from_orig: &[U],
    to_orig: &[U],
    common_prefix_length_ignoring_case: impl FnOnce(&[U], &[U]) -> usize,
) -> Relative {
    let (from_range, to_range) = (trim_backslashes(from_orig), trim_backslashes(to_orig));
    let is_trimmed_alike = from_range == to_range && from_orig.len() == to_orig.len();
    let (to_start, to_end) = (to_range.start, to_range.end);
    let (from, to) = (&from_orig[from_range], &to_orig[to_range]);
    let common = common_prefix_length_ignoring_case(from, to);
    let last_sep = || scan::last_index_of_sep::<U, BACKSLASH>(&from[..common]);

    let last_common_sep = match (from.get(common), to.get(common)) {
        (None, Some(next)) if next.eq_ascii(BACKSLASH) => {
            return Relative::slice_of_to(to_start + common + 1..to_orig.len());
        }
        (None, Some(_)) if common == DRIVE_LEN => {
            return Relative::slice_of_to(to_start + common..to_orig.len());
        }
        (None, None) if is_trimmed_alike => return Relative::EMPTY,
        (Some(next), None) if next.eq_ascii(BACKSLASH) => common,
        (Some(_), None) if common == DRIVE_LEN => DRIVE_ROOT_LEN,
        (Some(_), Some(_)) => match last_sep() {
            Some(last_sep) => last_sep,
            None => return Relative::slice_of_to(0..to_orig.len()),
        },
        _ => last_sep().unwrap_or(0),
    };

    let rest_start = to_start + last_common_sep;
    match from.get(last_common_sep + 1..) {
        Some(remaining) => Relative {
            dotdots: 1 + scan::count_seps::<U, BACKSLASH>(remaining),
            rest: rest_start.min(to_end)..to_end,
        },
        None => {
            let rest_start = rest_start + usize::from(byte_at(to_orig, rest_start) == BACKSLASH);
            Relative::slice_of_to(rest_start.min(to_end)..to_end)
        }
    }
}

/// For "İ", which is longer in lower case: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L626-L663>
#[cold]
fn relative_by_segments(lower_from: &[u16], lower_to: &[u16], to: &[u16]) -> Relative {
    fn segments(path: &[u16]) -> impl Iterator<Item = &[u16]> {
        let mut segments = path.split(|unit| unit.eq_ascii(BACKSLASH));
        if path.last().is_none_or(|last| last.eq_ascii(BACKSLASH)) {
            segments.next_back();
        }
        segments
    }
    if lower_from == lower_to {
        return Relative::EMPTY;
    }
    let pairs = segments(lower_from).zip(segments(lower_to));
    let common = pairs.take_while(|(from, to)| from == to).count();
    if common == 0 {
        return Relative::slice_of_to(0..to.len());
    }
    let dotdots = segments(lower_from).count() - common;
    let end = to.len() - usize::from(to[to.len() - 1].eq_ascii(BACKSLASH));
    let common_len: usize = segments(to).take(common).map(|it| it.len() + 1).sum();
    Relative {
        dotdots,
        rest: if dotdots == 0 {
            end.min(common_len)..end
        } else {
            common_len - 1..end
        },
    }
}
