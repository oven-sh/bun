//! `cargo test -p bun_paths`, and `bun run rust:miri -p bun_paths`.

use core::cell::Cell;
use core::convert::Infallible;
use core::fmt;
use core::mem::MaybeUninit;

use bun_core::strings;

use crate::path::GenericPath;
use crate::path_backend::{HeapBackend, PathBackend, StackBackend};
use crate::path_style::{PathStyle, Posix, VolumeKind, Windows};
use crate::path_unit::PathUnit;
use crate::{MAX_PATH_BYTES, NameTooLong, PATH_MAX_WIDE, Path, StackPath, portable};

/// Stand in for the C++ functions, which are not linked into this test binary.
mod ffi_stubs {
    use bun_core::strings;
    use bun_simdutf_sys::simdutf::{SIMDUTFResult, Status};

    const SURROGATE: Status = Status(6);

    unsafe fn slice_from_raw<'a, T>(units: *const T, len: usize) -> &'a [T] {
        // SAFETY: the callers of the stubs pass a slice as a pointer and a length.
        unsafe { core::slice::from_raw_parts(units, len) }
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_index_of_untidy_slash(path: *const u8, len: usize) -> usize {
        // SAFETY: see `slice_from_raw`.
        let path = unsafe { slice_from_raw(path, len) };
        let is_untidy = |at: &usize| {
            matches!(
                path[*at..],
                [b'/', b'/', ..]
                    | [b'/', b'.']
                    | [b'/', b'.', b'/', ..]
                    | [b'/', b'.', b'.']
                    | [b'/', b'.', b'.', b'/', ..]
            )
        };
        (0..len).find(is_untidy).unwrap_or(len)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_last_index_of_slash(path: *const u8, len: usize) -> usize {
        // SAFETY: see `slice_from_raw`.
        strings::last_index_of_char(unsafe { slice_from_raw(path, len) }, b'/').unwrap_or(len)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_count_slashes(path: *const u8, len: usize) -> usize {
        // SAFETY: see `slice_from_raw`.
        strings::count_char(unsafe { slice_from_raw(path, len) }, b'/')
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_common_prefix_length(
        a: *const u8,
        b: *const u8,
        len: usize,
    ) -> usize {
        // SAFETY: see `slice_from_raw`.
        let (a, b) = unsafe { (slice_from_raw(a, len), slice_from_raw(b, len)) };
        (0..len).find(|&at| a[at] != b[at]).unwrap_or(len)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_memmem16(
        h: *const u16,
        n: usize,
        nd: *const u16,
        k: usize,
    ) -> usize {
        // SAFETY: see `slice_from_raw`.
        let (h, nd) = unsafe { (slice_from_raw(h, n), slice_from_raw(nd, k)) };
        (0..n)
            .find(|&at| h[at..].starts_with(nd))
            .unwrap_or(usize::MAX)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
        units: *const u16,
        len: usize,
    ) -> usize {
        // SAFETY: see `slice_from_raw`.
        char::decode_utf16(unsafe { slice_from_raw(units, len) }.iter().copied())
            .map(|c| c.map_or(3, char::len_utf8))
            .sum()
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
        units: *const u16,
        len: usize,
        out: *mut u8,
    ) -> SIMDUTFResult {
        let mut count = 0;
        // SAFETY: see `slice_from_raw`.
        for c in char::decode_utf16(unsafe { slice_from_raw(units, len) }.iter().copied()) {
            let Ok(c) = c else {
                return SIMDUTFResult {
                    status: SURROGATE,
                    count,
                };
            };
            for byte in c.encode_utf8(&mut [0; 4]).bytes() {
                // SAFETY: the caller reserved the space, which Miri checks here.
                unsafe { out.add(count).write(byte) };
                count += 1;
            }
        }
        SIMDUTFResult {
            status: Status::SUCCESS,
            count,
        }
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_index_of_char(
        haystack: *const u8,
        haystack_len: usize,
        needle: u8,
    ) -> usize {
        // SAFETY: see `slice_from_raw`.
        let haystack = unsafe { slice_from_raw(haystack, haystack_len) };
        haystack
            .iter()
            .position(|&b| b == needle)
            .unwrap_or(haystack_len)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_index_of_any_char(
        text: *const u8,
        text_len: usize,
        chars: *const u8,
        chars_len: usize,
    ) -> usize {
        // SAFETY: see `slice_from_raw`.
        let (text, chars) = unsafe {
            (
                slice_from_raw(text, text_len),
                slice_from_raw(chars, chars_len),
            )
        };
        text.iter()
            .position(|b| chars.contains(b))
            .unwrap_or(text_len)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_last_index_of_char(h: *const u8, n: usize, c: u8) -> usize {
        // SAFETY: see `slice_from_raw`.
        let h = unsafe { slice_from_raw(h, n) };
        h.iter().rposition(|&b| b == c).unwrap_or(n)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_count_char(h: *const u8, n: usize, c: u8) -> usize {
        // SAFETY: see `slice_from_raw`.
        let h = unsafe { slice_from_raw(h, n) };
        h.iter().filter(|&&b| b == c).count()
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_memrmem16(
        h: *const u16,
        n: usize,
        nd: *const u16,
        k: usize,
    ) -> usize {
        // SAFETY: see `slice_from_raw`.
        let (h, nd) = unsafe { (slice_from_raw(h, n), slice_from_raw(nd, k)) };
        let last = n
            .checked_sub(k)
            .and_then(|end| (0..=end).rev().find(|&i| h[i..i + k] == *nd));
        last.unwrap_or(usize::MAX)
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> SIMDUTFResult {
        // SAFETY: see `slice_from_raw`.
        let input = unsafe { slice_from_raw(buf, len) };
        let mut written = 0usize;
        let mut i = 0usize;
        while i < len {
            let b = input[i];
            let cont = |off: usize| i + off < len && input[i + off] & 0xC0 == 0x80;
            let (cp, adv): (u32, usize) = if b < 0x80 {
                (b as u32, 1)
            } else if (0xC2..0xE0).contains(&b) && cont(1) {
                (
                    (u32::from(b & 0x1F) << 6) | u32::from(input[i + 1] & 0x3F),
                    2,
                )
            } else if (0xE0..0xF0).contains(&b) && cont(1) && cont(2) {
                let cp = (u32::from(b & 0x0F) << 12)
                    | (u32::from(input[i + 1] & 0x3F) << 6)
                    | u32::from(input[i + 2] & 0x3F);
                if (0xD800..=0xDFFF).contains(&cp) {
                    return SIMDUTFResult {
                        status: SURROGATE,
                        count: i,
                    };
                }
                (cp, 3)
            } else if (0xF0..0xF5).contains(&b) && cont(1) && cont(2) && cont(3) {
                (
                    (u32::from(b & 0x07) << 18)
                        | (u32::from(input[i + 1] & 0x3F) << 12)
                        | (u32::from(input[i + 2] & 0x3F) << 6)
                        | u32::from(input[i + 3] & 0x3F),
                    4,
                )
            } else {
                return SIMDUTFResult {
                    status: Status::TOO_SHORT,
                    count: i,
                };
            };
            // SAFETY: the caller reserved the space, which Miri checks here.
            unsafe {
                if cp <= 0xFFFF {
                    utf16_output.add(written).write(cp as u16);
                    written += 1;
                } else {
                    let v = cp - 0x10000;
                    utf16_output.add(written).write(0xD800 + (v >> 10) as u16);
                    utf16_output
                        .add(written + 1)
                        .write(0xDC00 + (v & 0x3FF) as u16);
                    written += 2;
                }
            }
            i += adv;
        }
        SIMDUTFResult {
            status: Status::SUCCESS,
            count: written,
        }
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize {
        // SAFETY: see `slice_from_raw`.
        let input = unsafe { slice_from_raw(input, length) };
        input
            .iter()
            .map(|&b| {
                if b & 0xC0 == 0x80 {
                    0
                } else if b >= 0xF0 {
                    2
                } else {
                    1
                }
            })
            .sum()
    }
}

thread_local!(static ALLOCATIONS: Cell<usize> = const { Cell::new(0) });

/// Off under Miri, which rejects how `System` frees an over-aligned box on Windows.
#[cfg(not(miri))]
mod counting {
    use std::alloc::{GlobalAlloc, Layout, System};

    use super::ALLOCATIONS;

    struct Counting;

    // SAFETY: forwards to `System`.
    unsafe impl GlobalAlloc for Counting {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            ALLOCATIONS.set(ALLOCATIONS.get() + 1);
            // SAFETY: the caller's contract.
            unsafe { System.alloc(layout) }
        }
        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            // SAFETY: the caller's contract.
            unsafe { System.dealloc(ptr, layout) }
        }
    }

    #[global_allocator]
    static ALLOCATOR: Counting = Counting;
}

trait Unit: PathUnit + fmt::Debug {
    fn encode(text: &str) -> Vec<Self>;
}
impl Unit for u8 {
    fn encode(text: &str) -> Vec<u8> {
        text.as_bytes().to_vec()
    }
}
impl Unit for u16 {
    fn encode(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }
}

thread_local!(static CAPACITY: Cell<usize> = const { Cell::new(1) });

/// `StackBackend` with `CAPACITY` for `N`, and one more unit that nothing may write to.
struct FixedBackend<U: Unit>(Vec<MaybeUninit<U>>);

impl<U: Unit> FixedBackend<U> {
    fn new(capacity: usize, contents: &[MaybeUninit<U>]) -> Self {
        let mut units = vec![MaybeUninit::new(U::from_u8(b'#')); capacity + 1];
        units[..contents.len()].copy_from_slice(contents);
        Self(units)
    }
}

impl<U: Unit> Default for FixedBackend<U> {
    fn default() -> Self {
        Self::new(CAPACITY.get(), &[MaybeUninit::new(*U::NUL)])
    }
}

impl<U: Unit> Drop for FixedBackend<U> {
    fn drop(&mut self) {
        // SAFETY: `new` initialized it.
        let guard = unsafe { self.0[self.0.len() - 1].assume_init() };
        assert_eq!(guard, U::from_u8(b'#'));
    }
}

impl<U: Unit> PathBackend for FixedBackend<U> {
    type Unit = U;
    type Error = NameTooLong;
    type Output<T> = Result<T, NameTooLong>;

    fn output<T>(result: Result<T, NameTooLong>) -> Result<T, NameTooLong> {
        result
    }

    fn as_ptr(&self) -> *const U {
        self.0.as_ptr().cast()
    }

    fn as_uninit_slice_mut(&mut self) -> &mut [MaybeUninit<U>] {
        let capacity = self.0.len() - 1;
        &mut self.0[..capacity]
    }

    unsafe fn grow(&mut self, _: usize, _: usize) -> Result<(), NameTooLong> {
        Err(NameTooLong)
    }
}

/// `HeapBackend` without the spare room, which would hide an edit that reserves too little.
struct ExactBackend<U: Unit = u8>(FixedBackend<U>);

impl<U: Unit> Default for ExactBackend<U> {
    fn default() -> Self {
        Self(FixedBackend::new(1, &[MaybeUninit::new(*U::NUL)]))
    }
}

impl<U: Unit> PathBackend for ExactBackend<U> {
    type Unit = U;
    type Error = Infallible;
    type Output<T> = T;

    fn output<T>(Ok(value): Result<T, Infallible>) -> T {
        value
    }

    fn as_ptr(&self) -> *const U {
        self.0.as_ptr()
    }

    fn as_uninit_slice_mut(&mut self) -> &mut [MaybeUninit<U>] {
        self.0.as_uninit_slice_mut()
    }

    unsafe fn grow(&mut self, len: usize, capacity: usize) -> Result<(), Infallible> {
        self.0 = FixedBackend::new(capacity, &self.0.0[..len]);
        Ok(())
    }
}

fn text(bytes: &[u8]) -> &str {
    core::str::from_utf8(bytes).unwrap()
}

fn init_cwd() -> &'static str {
    crate::fs::FileSystem::init(b"/cwd/");
    text(crate::fs::top_level_dir())
}

#[derive(Debug, Clone)]
enum Op {
    Set(String),
    ExtendFromSlice(String),
    Prepend(String),
    WriteFmt(String, String),
    Push(String),
    PushFmt(String, String),
    PushInside(String),
    SetBasename(String),
    SetExtension(String),
    PushTrailingSep,
    CopyTrailingSepFrom(String),
    Join(Vec<String>),
    Resolve(Vec<String>),
    Relative(String, String),
    MakeLongPath,
    MakeNtPath,
    StripNtPrefix,
}

const NORMALIZE: Op = Op::Join(Vec::new());

fn apply<B: PathBackend<Unit: Unit>, S: PathStyle, C: Unit>(
    path: &mut GenericPath<B, S>,
    op: &Op,
) -> B::Output<()> {
    let with_parts = |parts: &[String], f: &mut dyn FnMut(&[&[C]]) -> B::Output<()>| {
        let parts: Vec<Vec<C>> = parts.iter().map(|part| C::encode(part)).collect();
        f(&parts.iter().map(|part| &part[..]).collect::<Vec<_>>())
    };
    let encode = B::Unit::encode;
    match op {
        Op::Set(arg) => path.set(&C::encode(arg)),
        Op::ExtendFromSlice(arg) => path.extend_from_slice(&C::encode(arg)),
        Op::Prepend(arg) => path.prepend(&encode(arg)),
        Op::WriteFmt(a, b) => write!(path, "{a}{b}"),
        Op::Push(arg) => path.push(&C::encode(arg)),
        Op::PushFmt(a, b) => path.push_fmt(format_args!("{a}{b}")),
        Op::PushInside(arg) => path.push_inside(&C::encode(arg)),
        Op::SetBasename(arg) => path.set_basename(&C::encode(arg)),
        Op::SetExtension(arg) => path.set_extension(&C::encode(arg)),
        Op::PushTrailingSep => path.push_trailing_sep(),
        Op::CopyTrailingSepFrom(arg) => path.copy_trailing_sep_from(&C::encode(arg)),
        Op::Join(parts) => with_parts(parts, &mut |parts| B::output(path.try_join(parts))),
        Op::Resolve(parts) => with_parts(parts, &mut |parts| path.resolve_in_place(parts)),
        Op::Relative(from, to) => B::output(path.try_relative(&encode(from), &encode(to))),
        Op::MakeLongPath => path.make_long_path(),
        Op::MakeNtPath => path.make_nt_path(),
        Op::StripNtPrefix => {
            path.strip_nt_prefix();
            B::output(Ok(()))
        }
    }
}

fn actual<S: PathStyle>(before: &str, op: &Op) -> String {
    init_cwd();
    let mut path = GenericPath::<ExactBackend, S>::from(before.as_bytes());
    apply::<_, S, u8>(&mut path, op);
    text(&path).to_owned()
}

/// Slow reference implementation.
mod model {
    use super::*;

    pub(super) struct Parsed {
        pub(super) kind: VolumeKind,
        /// Normalized, e.g. `C:`.
        pub(super) volume: String,
        pub(super) root: String,
        /// What follows the volume.
        pub(super) tail: String,
        pub(super) components: Vec<String>,
    }

    impl Parsed {
        pub(super) fn has_sep(&self) -> bool {
            self.root.ends_with(['/', '\\']) && self.tail.starts_with(['/', '\\'])
        }
        pub(super) fn is_absolute(&self) -> bool {
            self.has_sep() || matches!(self.kind, VolumeKind::Unc | VolumeKind::Device)
        }
    }

    pub(super) fn is_sep<S: PathStyle>(c: char) -> bool {
        c == '/' || (S::WIN32 && c == '\\')
    }

    fn sep<S: PathStyle>() -> String {
        char::from(S::SEP).to_string()
    }

    pub(super) fn components<S: PathStyle>(path: &str) -> Vec<String> {
        let chars: Vec<char> = path.chars().collect();
        let components = chars
            .split(|&c| is_sep::<S>(c))
            .filter(|component| !component.is_empty());
        components.map(String::from_iter).collect()
    }

    fn normalize_seps<S: PathStyle>(path: &str) -> String {
        let normalize = |c| {
            if is_sep::<S>(c) {
                char::from(S::SEP)
            } else {
                c
            }
        };
        path.chars().map(normalize).collect()
    }

    pub(super) fn parse<S: PathStyle>(path: &str) -> Parsed {
        let chars: Vec<char> = path.chars().collect();
        let sep_at = |at: usize| chars.get(at).is_some_and(|&c| is_sep::<S>(c));
        let all = components::<S>(path);
        let is_double = S::WIN32 && sep_at(0) && sep_at(1) && chars.len() > 2 && !sep_at(2);
        let is_nt = S::WIN32 && (path == r"\??" || path.starts_with(r"\??\"));
        let is_drive =
            S::WIN32 && !sep_at(0) && chars.get(1) == Some(&':') && chars[0].len_utf16() == 1;

        let (kind, volume, volume_len) = if is_double || is_nt {
            let is_device = is_nt || all[0] == "." || all[0] == "?";
            let is_unc = all
                .get(1)
                .is_some_and(|name| name.eq_ignore_ascii_case("unc"));
            let count = all.len().min(if is_device && is_unc { 4 } else { 2 });
            let ends = (1..=chars.len())
                .filter(|&at| !sep_at(at - 1) && (sep_at(at) || at == chars.len()));
            (
                if is_device {
                    VolumeKind::Device
                } else {
                    VolumeKind::Unc
                },
                sep::<S>().repeat(if is_nt { 1 } else { 2 }) + &all[..count].join(&sep::<S>()),
                ends.take(count).last().unwrap(),
            )
        } else if is_drive {
            let letter = chars[0].to_ascii_uppercase();
            (VolumeKind::Drive, format!("{letter}:"), 2)
        } else {
            (VolumeKind::None, String::new(), 0)
        };
        let tail = String::from_iter(&chars[volume_len..]);
        Parsed {
            kind,
            volume,
            root: String::from_iter(&chars[..volume_len + usize::from(sep_at(volume_len))]),
            components: components::<S>(&tail),
            tail,
        }
    }

    fn prevent_new_volume<S: PathStyle>(before: &Parsed, mut path: String) -> String {
        if before.kind == VolumeKind::None && parse::<S>(&path).kind != VolumeKind::None {
            match path.chars().take(2).all(is_sep::<S>) {
                true => path.insert_str(2, &sep::<S>()),
                false => path.insert_str(before.root.len(), &format!(".{}", sep::<S>())),
            }
        }
        path
    }

    fn collapse_dots(parsed: &Parsed) -> Vec<String> {
        let mut kept: Vec<String> = Vec::new();
        for name in &parsed.components {
            if name == ".." && kept.last().is_some_and(|last| last != "..") {
                kept.pop();
            } else if name != "." && !(name == ".." && parsed.is_absolute()) {
                kept.push(name.clone());
            }
        }
        kept
    }

    fn render<S: PathStyle>(parsed: &Parsed, trailing_sep: bool) -> String {
        let mut kept = collapse_dots(parsed);
        if kept.is_empty() && !parsed.is_absolute() {
            kept.push(".".into());
        }
        let mut path = parsed.volume.clone();
        if parsed.has_sep() || parsed.kind == VolumeKind::Unc {
            path += &sep::<S>();
        }
        path += &kept.join(&sep::<S>());
        if !kept.is_empty() && trailing_sep {
            path += &sep::<S>();
        }
        prevent_new_volume::<S>(parsed, path)
    }

    /// Parses `path` as if it had no drive or share.
    fn without_volume<S: PathStyle>(path: &str, is_absolute: bool) -> Parsed {
        Parsed {
            kind: VolumeKind::None,
            volume: String::new(),
            root: path.chars().take(usize::from(is_absolute)).collect(),
            tail: path.into(),
            components: components::<S>(path),
        }
    }

    fn join<S: PathStyle>(parts: &[&str]) -> String {
        let parts = parts.iter().copied().filter(|part| !part.is_empty());
        let parts: Vec<&str> = parts.collect();
        let first = parse::<S>(parts.first().unwrap_or(&""));
        let all = parts.join(&sep::<S>());
        let parsed = match first.kind {
            VolumeKind::None => without_volume::<S>(&all, first.is_absolute()),
            _ => parse::<S>(&all),
        };
        render::<S>(&parsed, parsed.tail.ends_with(is_sep::<S>))
    }

    pub(super) fn eq_path<S: PathStyle>(a: &str, b: &str) -> bool {
        let (a, b) = (normalize_seps::<S>(a), normalize_seps::<S>(b));
        a == b || (S::WIN32 && a.eq_ignore_ascii_case(&b))
    }

    fn resolve_to_parsed<S: PathStyle>(parts: &[&str]) -> Parsed {
        let parts = parts.iter().filter(|part| !part.is_empty());
        let parts: Vec<(&str, Parsed)> = parts.map(|&part| (part, parse::<S>(part))).collect();
        let raw_volume =
            |(part, parsed): &(&str, Parsed)| part[..part.len() - parsed.tail.len()].to_owned();
        let volume = parts
            .iter()
            .map(raw_volume)
            .rfind(|volume| !volume.is_empty())
            .unwrap_or_default();
        let is_base = |at: usize| {
            let parsed = &parts[at].1;
            parsed.is_absolute()
                || (at == 0 && parsed.kind == VolumeKind::Drive && parsed.tail.is_empty())
        };
        let is_relevant = |at: &usize| {
            let part_volume = normalize_seps::<S>(&raw_volume(&parts[*at]));
            part_volume.is_empty()
                || part_volume.eq_ignore_ascii_case(&normalize_seps::<S>(&volume))
        };
        let relevant: Vec<usize> = (0..parts.len()).filter(is_relevant).collect();
        let start = relevant.iter().rposition(|&at| is_base(at)).unwrap_or(0);
        let tails = relevant[start..].iter().map(|&at| &parts[at].1.tail[..]);
        let tail = tails
            .filter(|tail| !tail.is_empty())
            .collect::<Vec<_>>()
            .join("/");
        let is_absolute = (0..parts.len()).any(is_base);
        if volume.is_empty() {
            return without_volume::<S>(&tail, is_absolute);
        }
        let is_drive = !volume.starts_with(is_sep::<S>);
        let needs_sep = if is_drive {
            is_absolute
        } else {
            !tail.is_empty()
        };
        let sep = if needs_sep { sep::<S>() } else { String::new() };
        parse::<S>(&format!("{volume}{sep}{tail}"))
    }

    pub(super) fn resolve<S: PathStyle>(parts: &[&str]) -> String {
        render::<S>(&resolve_to_parsed::<S>(parts), false)
    }

    fn relative<S: PathStyle>(from: &str, to: &str) -> String {
        let from = resolve_to_parsed::<S>(&[init_cwd(), from]);
        let to = resolve_to_parsed::<S>(&[init_cwd(), to]);
        if !eq_path::<S>(&from.volume, &to.volume) {
            return render::<S>(&to, false);
        }
        let (from, to) = (collapse_dots(&from), collapse_dots(&to));
        let common = from
            .iter()
            .zip(&to)
            .take_while(|(a, b)| eq_path::<S>(a, b))
            .count();
        let mut components = vec!["..".to_owned(); from.len() - common];
        components.extend_from_slice(&to[common..]);
        prevent_new_volume::<S>(&parse::<S>(""), components.join(&sep::<S>()))
    }

    pub(super) fn without_trailing_sep<S: PathStyle>(path: &str, min_len: usize) -> &str {
        &path[..path.trim_end_matches(is_sep::<S>).len().max(min_len)]
    }

    fn push<S: PathStyle>(path: &str, part: &str) -> String {
        let parsed = parse::<S>(part);
        if path.is_empty() && !parsed.root.is_empty() {
            return prevent_new_volume::<S>(
                &parsed,
                normalize_seps::<S>(without_trailing_sep::<S>(part, parsed.root.len())),
            );
        }
        let mut rest = without_trailing_sep::<S>(part, 0);
        loop {
            rest = rest.trim_start_matches(is_sep::<S>);
            match rest.strip_prefix('.') {
                Some(after) if after.is_empty() || after.starts_with(is_sep::<S>) => rest = after,
                _ => break,
            }
        }
        if rest.is_empty() {
            return if path.is_empty() && !part.is_empty() {
                "."
            } else {
                path
            }
            .into();
        }
        let needs_sep = !path.is_empty() && !path.ends_with(is_sep::<S>);
        let sep = if needs_sep { sep::<S>() } else { String::new() };
        let pushed = format!("{path}{sep}{}", normalize_seps::<S>(rest));
        prevent_new_volume::<S>(&parse::<S>(path), pushed)
    }

    fn push_inside<S: PathStyle>(path: &str, part: &str) -> String {
        let names = collapse_dots(&without_volume::<S>(&format!("/{part}"), true));
        match names.join(&sep::<S>()) {
            inside if inside.is_empty() => path.into(),
            inside => push::<S>(path, &format!("./{inside}")),
        }
    }

    pub(super) fn parent<S: PathStyle>(path: &str) -> &str {
        let parsed = parse::<S>(path);
        let path = without_trailing_sep::<S>(path, parsed.root.len());
        let name_len = parsed.components.last().map_or(0, String::len);
        without_trailing_sep::<S>(&path[..path.len() - name_len], parsed.root.len())
    }

    pub(super) fn extension(name: &str) -> &str {
        match strings::last_index_of_char(name.as_bytes(), b'.') {
            Some(dot) if dot > 0 && name != ".." => &name[dot..],
            _ => "",
        }
    }

    fn add_namespace_prefix<S: PathStyle>(path: &str, prefix: &str) -> String {
        if !S::WIN32 || path.is_empty() {
            return path.into();
        }
        let is_nt = prefix == r"\??\";
        if !is_nt && parse::<S>(path).kind == VolumeKind::Device && !path.starts_with(r"\??") {
            return normalize_seps::<S>(path);
        }
        let mut path = join::<S>(&[path]);
        let parsed = parse::<S>(&path);
        if path.len() > parsed.root.len() && path.ends_with(is_sep::<S>) {
            path.pop();
        }
        match (parsed.kind, parsed.is_absolute(), is_nt) {
            (VolumeKind::Drive, true, _) | (VolumeKind::None, true, true) => {
                format!("{prefix}{path}")
            }
            (VolumeKind::Unc, ..) => format!(r"{prefix}UNC{}", &path[1..]),
            (VolumeKind::Device, ..) => {
                if path.as_bytes().get(5) == Some(&b':') {
                    path[4..5].make_ascii_uppercase();
                }
                format!("{}{}", &prefix[..3], &path[3..])
            }
            _ => path,
        }
    }

    fn strip_nt_prefix<S: PathStyle>(path: &str) -> String {
        let parsed = parse::<S>(path);
        if parsed.kind != VolumeKind::Device || &path[2..3] != "?" {
            return path.into();
        }
        let inner = path[3..].trim_start_matches(is_sep::<S>);
        let volume = components::<S>(&parsed.volume);
        if volume.len() > 2 {
            let share = sep::<S>().repeat(2) + inner[3..].trim_start_matches(is_sep::<S>);
            if parse::<S>(&share).kind == VolumeKind::Unc {
                return share;
            }
        } else if parse::<S>(inner).kind == VolumeKind::Drive && parse::<S>(inner).is_absolute() {
            return inner.into();
        }
        path.into()
    }

    pub(super) fn expected<S: PathStyle>(path: &str, op: &Op) -> String {
        let with_path = |parts: &'_ [String], f: fn(&[&str]) -> String| {
            let mut all = vec![path];
            all.extend(parts.iter().map(|part| &part[..]));
            f(&all)
        };
        let parsed = parse::<S>(path);
        match op {
            Op::Set(arg) => arg.clone(),
            Op::ExtendFromSlice(arg) => format!("{path}{arg}"),
            Op::Prepend(arg) => format!("{arg}{path}"),
            Op::WriteFmt(a, b) => format!("{path}{a}{b}"),
            Op::Push(arg) => push::<S>(path, arg),
            Op::PushFmt(a, b) => push::<S>(path, &format!("{a}{b}")),
            Op::PushInside(arg) => push_inside::<S>(path, arg),
            Op::SetBasename(arg) => match parsed.components.last() {
                None => push::<S>(path, arg),
                Some(name) => {
                    let path = without_trailing_sep::<S>(path, 0);
                    format!("{}{arg}", &path[..path.len() - name.len()])
                }
            },
            Op::SetExtension(arg) => match parsed.components.last().map(|name| &name[..]) {
                None | Some("." | "..") => path.into(),
                Some(name) => {
                    let path = without_trailing_sep::<S>(path, 0);
                    format!("{}{arg}", &path[..path.len() - extension(name).len()])
                }
            },
            Op::PushTrailingSep if path.is_empty() || path.ends_with(is_sep::<S>) => path.into(),
            Op::PushTrailingSep => format!("{path}{}", sep::<S>()),
            Op::CopyTrailingSepFrom(arg) if arg.ends_with(is_sep::<S>) => {
                expected::<S>(path, &Op::PushTrailingSep)
            }
            Op::CopyTrailingSepFrom(_) => path.into(),
            Op::Join(parts) => with_path(parts, join::<S>),
            Op::Resolve(parts) => with_path(parts, resolve::<S>),
            Op::Relative(from, to) => relative::<S>(from, to),
            Op::MakeLongPath => add_namespace_prefix::<S>(path, r"\\?\"),
            Op::MakeNtPath => add_namespace_prefix::<S>(path, r"\??\"),
            Op::StripNtPrefix => strip_nt_prefix::<S>(path),
        }
    }
}

struct Random(u64);

impl Random {
    fn below(&mut self, n: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % n as u64) as usize
    }

    fn path(&mut self) -> String {
        const PIECES: &[&str] = &[
            "/", "/", r"\", r"\", "//", r"\\", ".", "..", "..", "./", "a", "A", "bc", ".d", "e.f",
            "C:", "c:", "D:", r"C:\", "1:", "é:", "世:", "😀:", ":", "?", "??", "UNC", "unc",
            "cwd", r"/a\A", r"/..\bc", r"\\s\h", r"\\S\H\", r"\\s\i", r"\\?\", r"\\.\", r"\??\",
        ];
        let count = self.below(7);
        (0..count)
            .map(|_| PIECES[self.below(PIECES.len())])
            .collect()
    }

    fn paths(&mut self) -> Vec<String> {
        let count = self.below(4);
        (0..count).map(|_| self.path()).collect()
    }

    fn op(&mut self, round: usize) -> Op {
        const ARMS: usize = 23;
        match round % ARMS {
            0 => Op::Set(self.path()),
            1 => Op::ExtendFromSlice(self.path()),
            2 => Op::Prepend(self.path()),
            3 => Op::WriteFmt(self.path(), self.path()),
            4 => Op::Push(self.path()),
            5 => Op::PushFmt(self.path(), self.path()),
            6 => Op::SetBasename(self.path()),
            7 => Op::SetExtension(self.path()),
            8 => Op::PushTrailingSep,
            9 => NORMALIZE,
            10 | 11 => Op::Join(self.paths()),
            12 | 13 => Op::Resolve(self.paths()),
            14 => Op::Relative(self.path(), self.path()),
            15 | 16 => {
                let base = self.path();
                Op::Relative(base.clone() + &self.path(), base + &self.path())
            }
            17 => Op::MakeLongPath,
            18 => Op::MakeNtPath,
            19 => Op::CopyTrailingSepFrom(self.path()),
            20 | 21 => Op::PushInside(self.path() + &self.path()),
            _ => Op::StripNtPrefix,
        }
    }
}

const ROUNDS: usize = if cfg!(miri) { 4 } else { 5_000 };

fn is_terminated<B: PathBackend, S: PathStyle>(path: &GenericPath<B, S>) -> bool {
    // SAFETY: the unit after the path is in bounds and initialized.
    unsafe { *path.as_slice().as_ptr_range().end == *B::Unit::NUL }
}

/// Succeeds exactly when the result fits. Otherwise the path is unchanged.
fn check_every_capacity<S: PathStyle, U: Unit, C: Unit>(before: &str, op: &Op, after: &str) {
    const EXTRA_CAPACITIES: usize = if cfg!(miri) { 2 } else { 48 };
    let (initial, expected) = (U::encode(before), U::encode(after));
    let mut grown = GenericPath::<HeapBackend<U>, S>::from(&initial);
    apply::<_, S, C>(&mut grown, op);
    assert_eq!(grown.as_slice(), expected, "{before:?} {op:?}");
    assert!(is_terminated(&grown));

    let mut exact = GenericPath::<ExactBackend<U>, S>::from(&initial);
    apply::<_, S, C>(&mut exact, op);
    assert_eq!(exact.as_slice(), expected, "{before:?} {op:?}");
    assert!(is_terminated(&exact));

    let min_capacity = initial.len() + 1;
    let tightest = expected.len().max(min_capacity);
    for capacity in (tightest - 1).max(min_capacity)..tightest + EXTRA_CAPACITIES {
        CAPACITY.set(capacity);
        let mut path = GenericPath::<FixedBackend<U>, S>::from(&initial).unwrap();
        let result = apply::<_, S, C>(&mut path, op);
        assert_eq!(
            result.is_ok(),
            expected.len() < capacity,
            "{before:?} {op:?} {capacity}"
        );
        let contents = if result.is_ok() { &expected } else { &initial };
        assert_eq!(path.as_slice(), contents, "{before:?} {op:?} {capacity}");
        assert!(is_terminated(&path));
    }
}

fn check_against_model<S: PathStyle>() {
    let mut random = Random(0x9E37_79B9_7F4A_7C15);
    for round in 0..12 * ROUNDS {
        let op = random.op(round);
        let before = match op {
            Op::Relative(..) => String::new(),
            _ => random.path(),
        };
        let check = match random.below(4) {
            0 => check_every_capacity::<S, u8, u8>,
            1 => check_every_capacity::<S, u8, u16>,
            2 => check_every_capacity::<S, u16, u8>,
            _ => check_every_capacity::<S, u16, u16>,
        };
        check(&before, &op, &model::expected::<S>(&before, &op));
    }
}

fn check_style_getters<S: PathStyle, U: Unit>(path: &str, dir: &str) {
    let (units, parsed) = (U::encode(path), model::parse::<S>(path));
    let after_drive = if parsed.kind == VolumeKind::Drive {
        &parsed.tail
    } else {
        path
    };
    let name = &model::components::<S>(after_drive)
        .pop()
        .unwrap_or_default()[..];
    let stem = &name[..name.len() - model::extension(name).len()];
    assert_eq!(S::root(&units), U::encode(&parsed.root), "{path:?}");
    let volume = &parsed.root[..parsed.root.len() - usize::from(parsed.has_sep())];
    assert_eq!(S::volume(&units), U::encode(volume), "{path:?}");
    assert_eq!(S::is_absolute(&units), parsed.is_absolute(), "{path:?}");
    assert_eq!(
        S::is_fully_qualified(&units),
        parsed.is_absolute() && !(S::WIN32 && parsed.volume.is_empty()),
        "{path:?}"
    );
    assert_eq!(S::basename(&units), U::encode(name), "{path:?}");
    assert_eq!(S::stem(&units), U::encode(stem), "{path:?}");
    assert_eq!(
        S::extension(&units),
        U::encode(model::extension(name)),
        "{path:?}"
    );

    let names: Vec<Vec<U>> = parsed
        .components
        .iter()
        .map(|name| U::encode(name))
        .collect();
    assert!(
        S::components(&units).eq(names.iter().map(|name| &name[..])),
        "{path:?}"
    );
    assert!(
        S::components(&units)
            .rev()
            .eq(names.iter().rev().map(|name| &name[..])),
        "{path:?}"
    );

    let min_len = match parsed.kind {
        VolumeKind::Unc => 0,
        _ => parsed.root.len(),
    };
    let trimmed = |path| U::encode(model::without_trailing_sep::<S>(path, min_len));
    assert_eq!(S::without_trailing_sep(&units), trimmed(path), "{path:?}");

    let has_parent = names.len() > usize::from(!parsed.is_absolute());
    assert_eq!(
        S::dirname(&units).map(S::without_trailing_sep),
        has_parent
            .then(|| trimmed(model::parent::<S>(path)))
            .as_deref(),
        "{path:?}"
    );
    assert_eq!(
        S::dirname_or_root(&units),
        S::dirname(&units).unwrap_or(&U::encode(&parsed.root)),
        "{path:?}"
    );

    let mut depths = parsed.components.iter().scan(0, |depth, name| {
        *depth += match &name[..] {
            "." => 0,
            ".." => -1,
            _ => 1,
        };
        Some(*depth)
    });
    assert_eq!(
        S::climbs_out(&units),
        !parsed.root.is_empty() || depths.any(|depth| depth < 0),
        "{path:?}"
    );

    let mut stripped = GenericPath::<HeapBackend<U>, S>::from(&units);
    stripped.strip_nt_prefix();
    assert_eq!(
        S::without_nt_prefix(&units),
        match S::has_leading_sep(stripped.as_slice()) {
            true => &units,
            false => stripped.as_slice(),
        },
        "{path:?}"
    );

    let dir_units = U::encode(dir);
    let is_in_both = |above: &&[U]| S::strip_prefix(&dir_units, above).is_some();
    assert_eq!(
        S::common_ancestor([&units[..], &dir_units].into_iter()),
        S::ancestors(&units).find(is_in_both),
        "{path:?} {dir:?}"
    );

    let root_counts = parsed.is_absolute() || (names.is_empty() && !path.is_empty());
    assert_eq!(
        S::ancestors(&units).count(),
        names.len() + usize::from(root_counts),
        "{path:?}"
    );
    for (depth, ancestor) in S::ancestors(&units).enumerate() {
        let rest = S::strip_prefix(&units, ancestor).unwrap_or_else(|| panic!("{path:?} {depth}"));
        let below = rest.split(|&unit| S::is_sep(unit));
        assert_eq!(below.filter(|name| !name.is_empty()).count(), depth);
    }

    if let Some(rest) = S::strip_prefix(path.as_bytes(), dir.as_bytes()).map(text) {
        assert!(path.ends_with(rest) && !rest.starts_with(model::is_sep::<S>));
        assert!(
            parsed.components.ends_with(&model::components::<S>(rest)),
            "{path:?} {dir:?}"
        );
        let both = [model::components::<S>(dir), model::components::<S>(rest)].concat();
        assert!(model::eq_path::<S>(
            &both.join("/"),
            &model::components::<S>(path).join("/")
        ));
        assert_eq!(
            dir.starts_with(model::is_sep::<S>),
            path.starts_with(model::is_sep::<S>)
        );
    }
}

fn check_invariants<S: PathStyle>() {
    let mut random = Random(0x2545_F491_4F6C_DD1D);
    let kind = |path: &str| {
        let parsed = model::parse::<S>(path);
        (parsed.kind, parsed.is_absolute())
    };
    for _ in 0..ROUNDS {
        let (a, b, c) = (random.path(), random.path(), random.path());
        check_style_getters::<S, u8>(&(a.clone() + &b), &a);
        check_style_getters::<S, u16>(&(a.clone() + &b), &a.to_ascii_uppercase());

        let normal = actual::<S>(&a, &NORMALIZE);
        assert_eq!(actual::<S>(&normal, &NORMALIZE), normal, "{a:?}");
        assert_eq!(kind(&normal), kind(&a), "{a:?}");

        let parts = [a.as_bytes(), b.as_bytes(), c.as_bytes()];
        let rest = vec![b.clone(), c.clone()];
        let joined = GenericPath::<ExactBackend, S>::join(&parts);
        assert_eq!(text(&joined), actual::<S>(&a, &Op::Join(rest.clone())));
        let resolved = GenericPath::<ExactBackend, S>::resolve(&parts);
        assert!(
            model::eq_path::<S>(text(&resolved), &actual::<S>(&a, &Op::Resolve(rest))),
            "{a:?} {b:?} {c:?}"
        );
        let pushed = [&a, &b, &c].iter().fold(String::new(), |path, part| {
            actual::<S>(&path, &Op::Push(part.to_string()))
        });
        assert_eq!(
            text(&GenericPath::<ExactBackend, S>::from_parts(&parts)),
            pushed
        );

        let (from, to) = (a.clone() + &b, a.clone() + &c);
        let relative = GenericPath::<ExactBackend, S>::relative(from.as_bytes(), to.as_bytes());
        let resolve =
            |parts: &[&str]| actual::<S>(&model::resolve::<S>(parts), &Op::PushTrailingSep);
        let followed = resolve(&[init_cwd(), &from, text(&relative)]);
        let target = resolve(&[init_cwd(), &to]);
        let only_from_has_volume =
            kind(&target).0 == VolumeKind::None && kind(&followed).0 != VolumeKind::None;
        assert!(
            only_from_has_volume || model::eq_path::<S>(&followed, &target),
            "{from:?} {to:?}"
        );

        let mut path = GenericPath::<ExactBackend, S>::from(a.as_bytes());
        drop(path.push_scoped(b.as_bytes()));
        assert_eq!(text(&path), a);

        let inside = actual::<S>(&normal, &Op::PushInside(b.clone() + &c));
        let below = inside.strip_prefix(&normal).unwrap();
        assert!(!model::components::<S>(below).contains(&"..".into()));
    }
}

macro_rules! for_each_style {
    ($($name:ident: $style:ty),*) => {$(
        mod $name {
            use super::*;
            #[test]
            fn matches_model_at_every_capacity() {
                check_against_model::<$style>();
            }
            #[test]
            fn invariants() {
                check_invariants::<$style>();
            }
        }
    )*};
}
for_each_style!(posix: Posix, windows: Windows);

/// Mirrors `RtlDetermineDosPathNameType_U`, plus the `\??\` prefix.
fn win32_path_type(path: &str) -> &'static str {
    let path: Vec<u16> = path.encode_utf16().collect();
    let is = |at: usize, set: &str| set.encode_utf16().any(|unit| path.get(at) == Some(&unit));
    if is(0, r"\") && is(1, "?") && is(2, "?") && (is(3, r"\") || path.len() == 3) {
        "nt"
    } else if is(0, r"\/") && !is(1, r"\/") {
        "rooted"
    } else if is(0, r"\/") {
        let is_device = is(2, ".?") && (is(3, r"\/") || path.len() == 3);
        if is_device { "device" } else { "unc" }
    } else if is(1, ":") {
        if is(2, r"\/") {
            "drive"
        } else {
            "drive-relative"
        }
    } else {
        "relative"
    }
}

#[test]
fn windows_ops_preserve_win32_path_type() {
    let mut random = Random(0xD1B5_4A32_D192_ED03);
    for _ in 0..ROUNDS {
        let (a, b) = (random.path(), random.path());
        let has_no_server = win32_path_type(&a) == "unc" && Windows::root(a.as_bytes()).len() == 1;
        let kind = if has_no_server {
            "rooted"
        } else {
            win32_path_type(&a)
        };
        assert_eq!(
            win32_path_type(&actual::<Windows>(&a, &NORMALIZE)),
            kind,
            "{a:?}"
        );
        if matches!(kind, "relative" | "rooted" | "drive" | "unc" | "device") && !a.is_empty() {
            let joined = actual::<Windows>(&a, &Op::Join(vec![b.clone()]));
            assert_eq!(win32_path_type(&joined), kind, "{a:?} {b:?}");
        }
        for root in [r"\", "x", r"C:\", r"\\s\h"] {
            let pushed = actual::<Windows>(root, &Op::Push(b.clone()));
            assert_eq!(win32_path_type(&pushed), win32_path_type(root), "{b:?}");
        }
        for root in ["", "/", r"\", "x", r"C:\", r"\\s\h"] {
            let pushed = actual::<Windows>(root, &Op::PushInside(b.clone()));
            assert_eq!(win32_path_type(&pushed), win32_path_type(root), "{b:?}");
        }
    }
}

#[test]
fn pushing_onto_two_separators_forms_no_volume() {
    for op in [
        Op::Push("s/h".into()),
        Op::PushFmt("s".into(), "/h".into()),
        Op::PushInside("?/C:".into()),
        Op::SetBasename("s".into()),
    ] {
        assert_eq!(
            Windows::volume(actual::<Windows>("//", &op).as_bytes()),
            b""
        );
    }
}

#[test]
fn namespace_prefix_round_trips() {
    let mut random = Random(0xA076_1D64_78BD_642F);
    for _ in 0..ROUNDS {
        let rest = vec![random.path(), random.path()];
        for (base, add) in [
            (r"C:\a", Op::MakeLongPath),
            (r"世:\", Op::MakeNtPath),
            (r"\\s\h\a", Op::MakeLongPath),
            (r"\\s\h", Op::MakeNtPath),
        ] {
            let trim = |path: &str| {
                let root_len = Windows::root(path.as_bytes()).len();
                model::without_trailing_sep::<Windows>(path, root_len).to_owned()
            };
            let joined = actual::<Windows>(base, &Op::Join(rest.clone()));
            let prefixed = actual::<Windows>(&joined, &add);
            let prefixed_first =
                actual::<Windows>(&actual::<Windows>(base, &add), &Op::Join(rest.clone()));
            assert_eq!(trim(&prefixed_first), prefixed);
            assert_eq!(actual::<Windows>(&prefixed, &add), prefixed);
            assert_eq!(
                actual::<Windows>(&prefixed, &Op::StripNtPrefix),
                trim(&joined)
            );
        }
    }
}

fn owned(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|&part| part.to_owned()).collect()
}

// The `*_matches_node` cases are from `test-path-*.js` of Node v26.12.1.

#[test]
fn normalize_matches_node() {
    for (path, expected) in [
        ("./fixtures///b/../b/c.js", "fixtures/b/c.js"),
        ("/foo/../../../bar", "/bar"),
        ("a//b//../b", "a/b"),
        ("///..//./foo/.//bar", "/foo/bar"),
        ("bar/foo../../", "bar/"),
        ("../foo../../../bar", "../../bar"),
        ("../.../.././.../../../bar", "../../bar"),
        ("../../../foo/../../../bar/../../", "../../../../../../"),
        (r"foo/bar\baz", r"foo/bar\baz"),
        ("", "."),
        ("./", "./"),
    ] {
        assert_eq!(actual::<Posix>(path, &NORMALIZE), expected);
    }
    for (path, expected) in [
        (
            "//server/share/dir/file.ext",
            r"\\server\share\dir\file.ext",
        ),
        ("C:", "C:."),
        (r"C:..\..\abc\..\def", r"C:..\..\def"),
        (r"C:\.", r"C:\"),
        ("file:stream", "file:stream"),
        (r"\\.\foo", r"\\.\foo"),
        (r"\\.\foo\", r"\\.\foo\"),
        ("test/../C:/Windows", r".\C:\Windows"),
        ("test/../C:Windows", r".\C:Windows"),
        ("test/C:foo/../../F:", r".\F:"),
        ("/test/../?/D:/Test", r"\?\D:\Test"),
        ("//test/../??/D:/Test", r"\\test\..\??\D:\Test"),
        (
            "//server/share/dir/../../../?/D:/file",
            r"\\server\share\?\D:\file",
        ),
    ] {
        assert_eq!(actual::<Windows>(path, &NORMALIZE), expected);
    }
}

#[test]
fn join_matches_node() {
    for (all, expected) in [
        (&["//foo", "bar"][..], r"\\foo\bar\"),
        (&["//foo/", "/bar"], r"\\foo\bar\"),
        (&["", "//foo", "bar"], r"\\foo\bar\"),
        (&["//", "foo/bar"], r"\foo\bar"),
        (&["/", "/foo/bar"], r"\foo\bar"),
        (&["///foo/bar"], r"\foo\bar"),
        (&["C:", "file"], r"C:\file"),
        (&["C:.", "file"], "C:file"),
        (&["./upload", "/../C:/Windows"], r".\C:\Windows"),
        (&["test", "..", "D:"], r".\D:"),
    ] {
        assert_eq!(actual::<Windows>("", &Op::Join(owned(all))), expected);
    }
}

#[test]
fn resolve_matches_node() {
    for (all, expected) in [
        (&["/var/lib", "../", "file/"][..], "/var/file"),
        (&["/var/lib", "/../", "file/"], "/file"),
        (&["/some/dir", ".", "/absolute/"], "/absolute"),
    ] {
        assert_eq!(actual::<Posix>("", &Op::Resolve(owned(all))), expected);
    }
    for (all, expected) in [
        (&[r"C:/blah\blah", "d:/games", "C:../a"][..], r"C:\blah\a"),
        (&["C:/ignore", "C:/some/file"], r"C:\some\file"),
        (&["D:/ignore", "D:some/dir//"], r"D:\ignore\some\dir"),
        (
            &["//server/share", "..", r"relative\"],
            r"\\server\share\relative",
        ),
        (&["C:/", "//"], r"C:\"),
        (&["C:/", "//server//share"], r"\\server\share\"),
        (&["C:/", "///some//dir"], r"C:\some\dir"),
        (
            &[r"C:\foo\tmp.3\", r"..\tmp.3\cycles\root.js"],
            r"C:\foo\tmp.3\cycles\root.js",
        ),
        (&[r"\\.\PHYSICALDRIVE0"], r"\\.\PHYSICALDRIVE0"),
    ] {
        assert_eq!(actual::<Windows>("", &Op::Resolve(owned(all))), expected);
    }
}

#[test]
fn relative_matches_node() {
    for (from, to, expected) in [
        (r"c:/blah\blah", "D:/games", r"D:\games"),
        ("c:/aaaa/bbbb", "c:/aaaa", ".."),
        ("c:/aaaa/bbbb", "c:/cccc", r"..\..\cccc"),
        ("c:/AaAa/bbbb", "c:/aaaa/bbbb", ""),
        ("c:/aaaaa/", "c:/aaaa/cccc", r"..\aaaa\cccc"),
        (r"C:\foo\bar\baz-quux", r"C:\foo\bar\baz", r"..\baz"),
        (r"\\foo\bar\baz", r"\\foo\bar", ".."),
        (r"\\foo\bar\baz-quux", r"\\foo\bar\baz", r"..\baz"),
        (r"C:\baz", r"\\foo\bar\baz", r"\\foo\bar\baz"),
    ] {
        assert_eq!(
            actual::<Windows>("", &Op::Relative(from.into(), to.into())),
            expected
        );
    }
}

#[test]
fn long_path_matches_node() {
    for (path, expected) in [
        ("", ""),
        ("C:/", r"\\?\C:\"),
        ("C:/foo", r"\\?\C:\foo"),
        ("C:/foo/", r"\\?\C:\foo"),
        ("//foo//bar/baz", r"\\?\UNC\foo\bar\baz"),
        (r"\\?\foo", r"\\?\foo"),
        (r"\\.\pipe\somepipe", r"\\.\pipe\somepipe"),
    ] {
        assert_eq!(actual::<Windows>(path, &Op::MakeLongPath), expected);
    }
}

#[test]
fn only_nt_normalizes_a_device_path() {
    for (path, long, nt) in [
        (r"\\?\c:\a\..\b\", r"\\?\c:\a\..\b\", r"\??\C:\b"),
        ("//./pipe/a/", r"\\.\pipe\a\", r"\??\pipe\a"),
        (r"\??\c:\a\..\b", r"\\?\C:\b", r"\??\C:\b"),
    ] {
        assert_eq!(actual::<Windows>(path, &Op::MakeLongPath), long);
        assert_eq!(actual::<Windows>(path, &Op::MakeNtPath), nt);
    }
}

#[test]
fn differs_from_node() {
    for (all, expected) in [
        (&[r"c:\a", "b"][..], r"C:\a\b"),
        (&[r"C:\a", "D:b"], r"D:\b"),
        (&["C:", "a"], r"C:\a"),
        (&["a", "b"], r"a\b"),
        (&[r"1:\a", r"..\.."], r"1:\"),
        (&[r"\\?\C:\a", r"..\..\b"], r"\\?\C:\b"),
        (&[r"\\?\C:\a", r"\b"], r"\\?\C:\b"),
        (&[r"\\?\UNC\s\h\a", r"..\..\b"], r"\\?\UNC\s\h\b"),
        (&[r"C:\a", r"\??\D:\b"], r"\??\D:\b"),
        (&[r"\a", r"..\??\C:\b"], r"\.\??\C:\b"),
        (&[r"C:\a", r"\\server"], r"\\server\"),
        (&[r"C:\a", "1:b"], r"1:\b"),
    ] {
        assert_eq!(actual::<Windows>("", &Op::Resolve(owned(all))), expected);
    }
    for (all, expected) in [
        (&["c:/a", "b"][..], r"C:\a\b"),
        (&["//server"], r"\\server\"),
        (&["1:/a/../.."], r"1:\"),
        (&["a", "C:"], r"a\C:"),
        (&[r"\\.\pipe\..\x"], r"\\.\pipe\x"),
    ] {
        assert_eq!(actual::<Windows>("", &Op::Join(owned(all))), expected);
    }
    let across_shares = Op::Relative(r"\\s\a\x".into(), r"\\s\b\y".into());
    assert_eq!(actual::<Windows>("", &across_shares), r"\\s\b\y");
    assert_eq!(Windows::dirname(br"\\?\UNC\s\h"), None);
}

#[test]
fn case_insensitive_only_on_windows() {
    let relative = Op::Relative("c:/a".into(), "C:/b".into());
    assert_eq!(actual::<Windows>("", &relative), r"..\b");
    assert_eq!(actual::<Posix>("", &relative), "../../C:/b");
    assert_eq!(Windows::strip_prefix(b"c:/a", b"C:/"), Some(&b"a"[..]));
    assert_eq!(Posix::strip_prefix(b"c:/a", b"C:/"), None);
}

#[test]
fn common_ancestor_ends_at_a_component() {
    let common = |paths: &[&'static str]| {
        Posix::common_ancestor(paths.iter().map(|path| path.as_bytes())).map(text)
    };
    assert_eq!(common(&["/a/bc/d", "/a/bd/d", "/a/b"]), Some("/a"));
    assert_eq!(common(&["/a/b/", "/a/b"]), Some("/a/b"));
    assert_eq!(common(&["/a", "/b"]), Some("/"));
    assert_eq!(common(&["a", "b"]), None);
    assert_eq!(common(&[]), None);
    let drives = [&br"C:\a"[..], br"D:\a"];
    assert_eq!(Windows::common_ancestor(drives.into_iter()), None);
}

#[test]
fn without_leading_dot_slash_removes_one() {
    for (path, posix, windows) in [
        ("./a", "a", "a"),
        ("././a", "./a", "./a"),
        (r".\a", r".\a", "a"),
        ("../a", "../a", "../a"),
        (".", ".", "."),
    ] {
        let path = path.as_bytes();
        assert_eq!(text(Posix::without_leading_dot_slash(path)), posix);
        assert_eq!(text(Windows::without_leading_dot_slash(path)), windows);
    }
}

#[test]
fn is_parent_or_equal_compares_components() {
    use crate::ParentEqual::{Equal, Parent, Unrelated};
    let ignores_case = cfg!(not(any(target_os = "linux", target_os = "android")));
    for (parent, child, expected) in [
        ("/a", "/a", Equal),
        ("/a/", "/a", Equal),
        ("/a", "/a/", Equal),
        ("/a", "/a/b", Parent),
        ("/a/", "/a/b", Parent),
        ("/", "/a", Parent),
        ("/a", "/ab", Unrelated),
        ("/a/b", "/a", Unrelated),
        ("/A", "/a/b", if ignores_case { Parent } else { Unrelated }),
        (
            "/a",
            r"/a\b",
            if cfg!(windows) { Parent } else { Unrelated },
        ),
    ] {
        let actual = crate::is_parent_or_equal(parent.as_bytes(), child.as_bytes());
        assert_eq!(actual, expected, "{parent:?} {child:?}");
    }
}

#[test]
fn converters_change_only_separators() {
    const MIXED: &[u8] = br"c:\a/.\\b/";
    let (posix, windows) = (r"c:/a/.//b/", r"c:\a\.\\b\");
    let on_windows = |converted| {
        if cfg!(windows) {
            converted
        } else {
            text(MIXED)
        }
    };
    assert_eq!(text(&crate::to_portable(MIXED)), on_windows(posix));
    assert_eq!(text(&Path::from(MIXED).into_portable()), on_windows(posix));
    assert_eq!(text(&crate::to_native(MIXED)), on_windows(windows));
    let mut wide = u16::encode(text(MIXED));
    Windows::to_native_in_place(&mut wide);
    assert_eq!(wide, u16::encode(windows));
    Windows::to_portable_in_place(&mut wide);
    assert_eq!(wide, u16::encode(posix));
}

#[test]
fn push_inside_stays_inside() {
    for (path, part, posix, windows) in [
        ("/a", "b/../../../c/", "/a/c", r"/a\c"),
        ("/a/", "/b//./c", "/a/b/c", r"/a/b\c"),
        ("/a", "b/..", "/a", "/a"),
        ("/a", r"..\b", r"/a/..\b", r"/a\b"),
        ("/", "C:/b", "/C:/b", r"/C:\b"),
        ("/", "//s/h", "/s/h", r"/s\h"),
        ("/", "??/b", "/??/b", r"/??\b"),
        ("", "../b", "b", "b"),
        ("", "C:/b", "C:/b", r".\C:\b"),
        ("", "..", "", ""),
    ] {
        let op = Op::PushInside(part.into());
        assert_eq!(actual::<Posix>(path, &op), posix);
        assert_eq!(actual::<Windows>(path, &op), windows);
    }
}

#[test]
fn portable_text_has_two_separators() {
    const WIN: bool = cfg!(windows);
    for (path, is_absolute, climbs_out, has_dot_dot) in [
        ("a/b", false, false, false),
        ("a/../b", false, false, true),
        (r"a\..\b", false, false, true),
        ("a../..b", false, false, false),
        ("../a", false, true, true),
        (r"..\a", false, true, true),
        (r"a\b/../..", false, !WIN, true),
        (r"a/..\..", false, true, true),
        ("..\0a", false, true, false),
        ("C:a", false, WIN, false),
        ("C:..", false, WIN, WIN),
        ("/a", true, true, false),
        ("//a/../b", true, true, true),
        ("//../b", true, true, true),
        (r"\a", true, WIN, false),
        (r"\..\a", true, true, true),
        (r"C:\a", true, WIN, false),
        ("", false, false, false),
    ] {
        let bytes = path.as_bytes();
        assert_eq!(portable::is_absolute(bytes), is_absolute, "{path:?}");
        assert_eq!(portable::climbs_out(bytes), climbs_out, "{path:?}");
        assert_eq!(portable::has_dot_dot(bytes), has_dot_dot, "{path:?}");
    }
}

#[test]
fn add_current_drive_completes_only_a_rooted_path() {
    for path in [
        "",
        "a",
        "C:a",
        r"C:\a",
        r"\\s\h\a",
        r"\\?\C:\a",
        r"\??\C:\a",
    ] {
        let mut actual = Path::from(path.as_bytes());
        actual.add_current_drive();
        assert_eq!(text(&actual), path);
    }
    let mut rooted = Path::from(b"/a");
    rooted.add_current_drive();
    assert!(rooted.ends_with(&[crate::SEP, b'a']) && crate::is_fully_qualified(&rooted));

    let mut full = StackPath::<4>::from(b"/ab").unwrap();
    assert_eq!(full.add_current_drive().is_err(), cfg!(windows));
    assert_eq!(full.as_bytes(), b"/ab");
}

#[test]
#[cfg(unix)]
fn from_portable_does_not_change_what_is_absolute() {
    for (path, expected) in [
        (r".\a\b", "./a/b"),
        (r"a/b\", "a/b/"),
        (r"\a", "./a"),
        (r"\\s\h", ".//s/h"),
        (r"\", "./"),
        (r"C:\a", "C:/a"),
        (r"/home/DOMAIN\user", r"/home/DOMAIN\user"),
        ("", ""),
    ] {
        assert_eq!(text(&crate::from_portable(path.as_bytes())), expected);
    }
}

#[test]
#[cfg(unix)]
fn from_portable_rooted_reads_a_leading_backslash_as_the_root() {
    for (path, expected) in [
        (r".\a\b", "./a/b"),
        (r"\a\b", "/a/b"),
        (r"/home/DOMAIN\user", r"/home/DOMAIN\user"),
    ] {
        let rooted = crate::portable::from_portable_rooted(path.as_bytes());
        assert_eq!(text(&rooted), expected);
    }
}

#[test]
fn share_is_a_root_without_its_separator() {
    for (path, expected) in [
        (r"\\s\h\", r"\\s\h"),
        (r"//s/h//", r"//s/h"),
        (r"C:\\", r"C:\"),
        (r"\\?\C:\", r"\\?\C:\"),
        (r"\\", r"\"),
    ] {
        assert_eq!(
            text(Windows::without_trailing_sep(path.as_bytes())),
            expected
        );
    }
}

#[test]
fn relative_can_be_longer_than_its_operands() {
    let up = Op::Relative("/a".repeat(99) + "/.", "/".into());
    assert_eq!(actual::<Posix>("", &up), [".."; 99].join("/"));
    assert_eq!(actual::<Windows>("", &up), [".."; 99].join(r"\"));
}

#[test]
fn transcodes_lone_surrogates_and_invalid_utf8() {
    let lone = [u16::from(b'a'), 0xD800, u16::from(b'/'), 0xDC00];
    let narrow = GenericPath::<ExactBackend, Posix>::from(&lone);
    assert_eq!(narrow.as_slice(), b"a\xED\xA0\x80/\xED\xB0\x80");
    assert_eq!(
        GenericPath::<ExactBackend<u16>, Posix>::from(&narrow).as_slice(),
        lone
    );
    let invalid = GenericPath::<ExactBackend<u16>, Posix>::from(b"\x80\xFF\xE4\xB8");
    assert_eq!(invalid.as_slice(), [0xFFFD; 4]);
    let widest = u16::encode("世世世世");
    assert_eq!(
        text(&GenericPath::<ExactBackend, Posix>::from(&widest)),
        "世世世世"
    );
    assert!(StackPath::<{ 3 * 4 }>::from(&widest).is_err());

    let mut exact = GenericPath::<StackBackend<9>, Posix>::new();
    assert_eq!(exact.set(&lone), Ok(()));
    assert_eq!(exact.extend_from_slice(&[0xD800u16]), Err(NameTooLong));
    assert_eq!(exact.as_slice(), narrow.as_slice());
    let mut exact = GenericPath::<StackBackend<3, u16>, Posix>::new();
    assert_eq!(exact.set("世世".as_bytes()), Ok(()));
    assert_eq!(exact.set(b"\x80\x80\x80"), Err(NameTooLong));
    assert_eq!(exact.as_slice(), u16::encode("世世"));
}

#[test]
fn finds_an_untidy_slash_wherever_it_is() {
    const MIDDLES: &[&str] = &[
        "", "/", "//", "/.", "/./", "/..", "/../", "/.a", "/..a", "/...", "/.a/..", "/Į", "/į",
        "į/",
    ];
    let lens = (0..40).step_by(if cfg!(miri) { 15 } else { 1 });
    for (before, after) in lens.clone().flat_map(|n| lens.clone().map(move |m| (n, m))) {
        for middle in MIDDLES {
            let path = "a".repeat(before) + middle + &"b".repeat(after);
            let found = u8::index_of_untidy_slash(path.as_bytes());
            assert_eq!(
                u16::index_of_untidy_slash(&u16::encode(&path)),
                found.map(|at| path[..at].encode_utf16().count()),
                "{path:?}"
            );
        }
    }
}

/// Every length at which the first allocation can end is crossed, by one edit and by many.
fn check_growth<U: Unit>() {
    let name = vec![U::from_u8(b'a'); 600];
    let mut unit_by_unit = GenericPath::<HeapBackend<U>, Posix>::new();
    for len in (1..name.len()).step_by(if cfg!(miri) { 51 } else { 1 }) {
        while unit_by_unit.len() < len {
            unit_by_unit.extend_from_slice(b"a");
        }
        assert_eq!(unit_by_unit.as_slice(), &name[..len]);
        assert!(is_terminated(&unit_by_unit));

        let mut path = GenericPath::<HeapBackend<U>, Posix>::from(&name[..len]);
        {
            let mut scope = path.push_scoped(b"b");
            assert_eq!(scope.len(), len + 2);
            scope.push(&name);
            scope.push(&name);
            assert_eq!(scope.len(), len + 2 + 2 * (1 + name.len()));
            assert!(is_terminated(&scope));
        }
        assert_eq!(path.as_slice(), &name[..len]);
        assert!(is_terminated(&path));
    }
}

#[test]
fn heap_grows_and_keeps_the_path() {
    check_growth::<u8>();
    check_growth::<u16>();
}

#[test]
fn a_usual_path_allocates_once() {
    let allocations = ALLOCATIONS.get();
    drop(Path::new());
    assert_eq!(ALLOCATIONS.get(), allocations);
    let mut path = Path::from(b"/home/user/project");
    for name in [
        "node_modules",
        ".bun",
        "react-dom@18.3.1+abcdef",
        "index.js",
    ] {
        path.push(name.as_bytes());
    }
    assert_eq!(ALLOCATIONS.get(), allocations + usize::from(!cfg!(miri)));
    for len in [191, 192, 255, 256, 447, 448] {
        let mut long = Path::from(&[b'a'; 448][..len]);
        let address = long.as_ptr();
        long.push(&[b'b'; 63]);
        assert_eq!(long.as_ptr(), address);
    }
    std::thread::spawn(move || drop(path)).join().unwrap();
}

fn check_path_max<U: Unit>(limit: usize) {
    let name = vec![U::from_u8(b'a'); limit];
    let from = GenericPath::<HeapBackend<U>, Posix>::from::<U>;
    assert_eq!(from(&name).as_slice(), name);
    assert!(from(&name[1..]).check_len().is_ok());
    assert!(from(&name).check_len().is_err());
}

#[test]
fn check_len_leaves_room_for_the_nul() {
    check_path_max::<u8>(MAX_PATH_BYTES);
    check_path_max::<u16>(PATH_MAX_WIDE);
}

fn check_stack<S: PathStyle, U: Unit>() {
    type Edit<S, U> = fn(&mut GenericPath<StackBackend<64, U>, S>) -> Result<(), NameTooLong>;
    const PART: &[u8] = b"a/../b/../c";
    let edits: [Edit<S, U>; 8] = [
        |path| path.set(PART),
        |path| path.extend_from_slice(PART),
        |path| write!(path, "{}", text(PART)),
        |path| path.push(PART),
        |path| path.push_fmt(format_args!("{}", text(PART))),
        |path| path.push_inside(PART),
        |path| path.try_join(&[PART]),
        |path| path.resolve_in_place(&[PART]),
    ];
    init_cwd();
    let allocations = ALLOCATIONS.get();
    for edit in edits {
        let mut path = GenericPath::<StackBackend<64, U>, S>::new();
        path.set(b"..").unwrap();
        edit(&mut path).unwrap();
        assert!(is_terminated(&path));
    }
    GenericPath::<StackBackend<64, U>, S>::relative(U::lit(b"//"), U::lit(b"..")).unwrap();

    let mut full = GenericPath::<StackBackend<3, U>, S>::from(U::lit(b"..")).unwrap();
    assert!(full.set(U::lit(b"UNC")).is_err());
    assert!(full.extend_from_slice(U::lit(b".")).is_err());
    assert!(full.push_trailing_sep().is_err());
    assert!(S::WIN32 || full.push(U::lit(b"..")).is_err());
    assert_eq!(ALLOCATIONS.get(), allocations);
}

#[test]
fn stack_does_not_allocate() {
    check_stack::<Posix, u8>();
    check_stack::<Windows, u16>();

    let widest = u16::encode("世世世世");
    let allocations = ALLOCATIONS.get();
    let path = StackPath::<{ 3 * 4 + 1 }>::from(&widest).unwrap();
    assert_eq!(ALLOCATIONS.get(), allocations);
    assert_eq!(text(&path), "世世世世");
}

#[test]
fn empty_paths_are_nul_terminated() {
    assert!(is_terminated(&Path::new()));
    assert!(is_terminated(&StackPath::<1>::new()));
    assert!(is_terminated(&bun_core::boxed_zeroed::<StackPath<1>>()));
    assert!(Path::new().as_mut_slice().is_empty());
    assert_eq!(Path::new().to_zbox().as_bytes_with_nul(), b"\0");
}

#[test]
fn truncate_cannot_lengthen() {
    let mut path = Path::from(b"/secret/token");
    path.set(b"a");
    path.truncate(13);
    assert_eq!(path.to_zbox().as_bytes_with_nul(), b"a\0");
}

#[test]
fn write_fmt_rolls_back_when_display_ignores_error() {
    struct IgnoresErrors;
    impl fmt::Display for IgnoresErrors {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let _ = f.write_str("too long for it");
            f.write_str("b")
        }
    }
    let mut path = StackPath::<8>::new();
    path.set(b"a").unwrap();
    assert_eq!(write!(path, "{IgnoresErrors}"), Err(NameTooLong));
    assert_eq!(
        path.push_fmt(format_args!("{IgnoresErrors}")),
        Err(NameTooLong)
    );
    assert_eq!(path.as_bytes_with_nul(), b"a\0");
}

// Two processes can read one clock value, and whatever else they both know is equal too: a hash, a pid that the clock cancels.
#[test]
#[cfg_attr(
    miri,
    ignore = "reads the clock and starts a process, which isolation forbids"
)]
#[expect(clippy::disallowed_methods, clippy::disallowed_types)]
fn tmpname_differs_between_processes() {
    const OTHER: &str = "BUN_PATHS_TMPNAME_OF_THE_OTHER_PROCESS";
    let mut buf = [0u8; 64];
    let name = crate::fs::FileSystem::tmpname(b"tmp", &mut buf).unwrap();
    let here = u64::from_str_radix(text(&name.as_bytes()[1..17]), 16).unwrap();
    let Ok(there) = std::env::var(OTHER) else {
        // `BUN_DEBUG_HASH_RANDOM_SEED` makes the seed equal in both processes, which is what it is for.
        let again = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "path_tests::tmpname_differs_between_processes"])
            .env(OTHER, here.to_string())
            .env_remove("BUN_DEBUG_HASH_RANDOM_SEED")
            .stdout(std::process::Stdio::null())
            .status();
        return assert!(again.unwrap().success());
    };
    // Their clocks are minutes apart at most, which explains the low 40 bits of a difference.
    assert_ne!((here ^ there.parse::<u64>().unwrap()) >> 40, 0);
}
