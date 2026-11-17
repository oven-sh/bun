//! `cargo test -p bun_paths`, and `bun run rust:miri -p bun_paths`.

use core::cell::Cell;
use core::fmt;

use bun_core::strings;

use crate::path_backend::PathBackend;
use crate::path_style::VolumeKind;
use crate::path_unit::PathUnit;
use crate::platform::{Posix, Windows};
use crate::{
    GenericPath, MAX_PATH_BYTES, NameTooLong, PATH_MAX_WIDE, Path, PathStyle, PoolBackend,
    PoolOrVecBackend, PoolPath, SliceBackend, SlicePath, StackBackend, StackPath, VecBackend,
    VecPath,
};

/// What `fs::with_known_dirs` reports in tests.
pub(crate) const KNOWN_DIR: &[u8] = br"/a\A/..\bc/a\/\a/C:\a/a\A\a/b\..\..\a/\";

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

struct LooseOnPosix;
impl PathStyle for LooseOnPosix {
    const SEP: u8 = b'/';
    const BACKSLASH_IS_SEP: bool = true;
    const WIN32: bool = false;
}

struct LooseOnWindows;
impl PathStyle for LooseOnWindows {
    const SEP: u8 = b'/';
    const BACKSLASH_IS_SEP: bool = true;
    const WIN32: bool = true;
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
    PushAnySep(String),
    PushFmt(String, String),
    SetBasename(String),
    SetExtension(String),
    PushTrailingSep,
    CopyTrailingSepFrom(String),
    Join(Vec<String>),
    Resolve(Vec<String>),
    ResolveAnySep(Vec<String>),
    Relative(String, String),
    RelativeAnySep(String, String),
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
        Op::PushAnySep(arg) => path.push_any_sep(&C::encode(arg)),
        Op::PushFmt(a, b) => path.push_fmt(format_args!("{a}{b}")),
        Op::SetBasename(arg) => path.set_basename(&C::encode(arg)),
        Op::SetExtension(arg) => path.set_extension(&C::encode(arg)),
        Op::PushTrailingSep => path.push_trailing_sep(),
        Op::CopyTrailingSepFrom(arg) => path.copy_trailing_sep_from(&C::encode(arg)),
        Op::Join(parts) => with_parts(parts, &mut |parts| B::output(path.try_join(parts))),
        Op::Resolve(parts) => with_parts(parts, &mut |parts| path.resolve_in_place(parts)),
        Op::ResolveAnySep(parts) => {
            with_parts(parts, &mut |parts| path.resolve_any_sep_in_place(parts))
        }
        Op::Relative(from, to) => B::output(path.try_relative::<false>(&encode(from), &encode(to))),
        Op::RelativeAnySep(from, to) => {
            B::output(path.try_relative::<true>(&encode(from), &encode(to)))
        }
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
    let mut path = GenericPath::<VecBackend, S>::from(before.as_bytes());
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
        fn has_sep(&self) -> bool {
            self.root.ends_with(['/', '\\']) && self.tail.starts_with(['/', '\\'])
        }
        pub(super) fn is_absolute(&self) -> bool {
            self.has_sep() || matches!(self.kind, VolumeKind::Unc | VolumeKind::Device)
        }
    }

    pub(super) fn is_sep<S: PathStyle>(c: char) -> bool {
        c == '/' || (S::BACKSLASH_IS_SEP && c == '\\')
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
        let is_nt = S::SEP == b'\\' && (path == r"\??" || path.starts_with(r"\??\"));
        let is_drive = S::BACKSLASH_IS_SEP
            && !sep_at(0)
            && chars.get(1) == Some(&':')
            && chars[0].len_utf16() == 1
            && (S::WIN32 || sep_at(2));

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
            let letter = if S::WIN32 {
                chars[0].to_ascii_uppercase()
            } else {
                chars[0]
            };
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
            path.insert_str(before.root.len(), &format!(".{}", sep::<S>()));
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
        match path.len() {
            0 | 1 => prevent_new_volume::<S>(&parse::<S>(path), pushed),
            _ => pushed,
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
        if S::SEP != b'\\' {
            return path.into();
        }
        let path = join::<S>(&[path]);
        let parsed = parse::<S>(&path);
        match (parsed.kind, parsed.is_absolute(), prefix == r"\??\") {
            (VolumeKind::Drive, true, _) | (VolumeKind::None, true, true) => {
                format!("{prefix}{path}")
            }
            (VolumeKind::Unc, ..) => format!(r"{prefix}UNC{}", &path[1..]),
            (VolumeKind::Device, _, true) => format!(r"\??{}", &path[3..]),
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

    fn convert_backslashes_except_known(path: &str) -> String {
        let is_known = |name: &str| text(KNOWN_DIR).split('/').any(|known| known == name);
        let convert = |name: &str| {
            let pieces: Vec<&str> = name.split('\\').collect();
            let kept = (1..=pieces.len()).rfind(|&n| is_known(&pieces[..n].join(r"\")));
            let (kept, rest) = pieces.split_at(kept.unwrap_or(1));
            [&[&kept.join(r"\")[..]], rest].concat().join("/")
        };
        path.split('/').map(convert).collect::<Vec<_>>().join("/")
    }

    fn any_sep_to_posix(part: &String) -> String {
        match part.chars().next() {
            Some('/') => convert_backslashes_except_known(part),
            Some('\\') => format!("./{}", normalize_seps::<LooseOnPosix>(part)),
            _ => normalize_seps::<LooseOnPosix>(part),
        }
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
            Op::PushAnySep(arg) if S::BACKSLASH_IS_SEP || arg.is_empty() => push::<S>(path, arg),
            Op::PushAnySep(arg) if path.is_empty() && arg.starts_with('/') => {
                push::<S>(path, &convert_backslashes_except_known(arg))
            }
            Op::PushAnySep(arg) => {
                push::<S>(path, &format!("./{}", normalize_seps::<LooseOnPosix>(arg)))
            }
            Op::PushFmt(a, b) => push::<S>(path, &format!("{a}{b}")),
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
            Op::ResolveAnySep(parts) if S::BACKSLASH_IS_SEP => with_path(parts, resolve::<S>),
            Op::ResolveAnySep(parts) => {
                let parts: Vec<String> = parts.iter().map(any_sep_to_posix).collect();
                with_path(&parts, resolve::<S>)
            }
            Op::Relative(from, to) => relative::<S>(from, to),
            Op::RelativeAnySep(from, to) if S::BACKSLASH_IS_SEP => relative::<S>(from, to),
            Op::RelativeAnySep(from, to) => {
                let relative = relative::<S>(&any_sep_to_posix(from), &any_sep_to_posix(to));
                collapse_dots(&without_volume::<LooseOnPosix>(&relative, false)).join("/")
            }
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
        const ARMS: usize = 25;
        match round % ARMS {
            0 => Op::Set(self.path()),
            1 => Op::ExtendFromSlice(self.path()),
            2 => Op::Prepend(self.path()),
            3 => Op::WriteFmt(self.path(), self.path()),
            4 => Op::Push(self.path()),
            5 => Op::PushAnySep(self.path()),
            6 => Op::PushFmt(self.path(), self.path()),
            7 => Op::SetBasename(self.path()),
            8 => Op::SetExtension(self.path()),
            9 => Op::PushTrailingSep,
            10 => NORMALIZE,
            11 | 12 => Op::Join(self.paths()),
            13 | 14 => Op::Resolve(self.paths()),
            15 => Op::ResolveAnySep(self.paths()),
            16 => Op::Relative(self.path(), self.path()),
            17 | 18 => {
                let base = self.path();
                Op::Relative(base.clone() + &self.path(), base + &self.path())
            }
            19 => Op::RelativeAnySep(self.path(), self.path()),
            20 => {
                let base = self.path();
                Op::RelativeAnySep(base.clone() + &self.path(), base + &self.path())
            }
            21 => Op::MakeLongPath,
            22 => Op::MakeNtPath,
            23 => Op::CopyTrailingSepFrom(self.path()),
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
    let mut grown = GenericPath::<VecBackend<U>, S>::from(&initial);
    apply::<_, S, C>(&mut grown, op);
    assert_eq!(grown.as_slice(), expected, "{before:?} {op:?}");
    assert!(is_terminated(&grown));

    let min_capacity = initial.len() + 1;
    let tightest = expected.len().max(min_capacity);
    for capacity in (tightest - 1).max(min_capacity)..tightest + EXTRA_CAPACITIES {
        let mut buffer = vec![U::from_u8(b'#'); capacity + 1];
        let mut path = GenericPath::<SliceBackend<'_, U>, S>::new(&mut buffer[..capacity]);
        path.set(&initial).unwrap();
        let result = apply::<_, S, C>(&mut path, op);
        assert_eq!(
            result.is_ok(),
            expected.len() < capacity,
            "{before:?} {op:?} {capacity}"
        );
        let contents = if result.is_ok() { &expected } else { &initial };
        assert_eq!(
            &**path.into_zstr(),
            contents,
            "{before:?} {op:?} {capacity}"
        );
        assert_eq!(buffer[contents.len()], *U::NUL);
        assert_eq!(buffer[capacity], U::from_u8(b'#'));
    }
}

fn check_against_model<S: PathStyle>() {
    let mut random = Random(0x9E37_79B9_7F4A_7C15);
    for round in 0..12 * ROUNDS {
        let op = random.op(round);
        let before = match op {
            Op::Relative(..) | Op::RelativeAnySep(..) => String::new(),
            _ => random.path(),
        };
        // Only `u8` paths have known directories.
        let uses_known_dirs = !S::BACKSLASH_IS_SEP
            && matches!(
                op,
                Op::PushAnySep(_) | Op::ResolveAnySep(_) | Op::RelativeAnySep(..)
            );
        let check = match random.below(if uses_known_dirs { 2 } else { 4 }) {
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
    assert_eq!(S::is_absolute(&units), parsed.is_absolute(), "{path:?}");
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

    let trimmed = model::without_trailing_sep::<S>(path, parsed.root.len());
    assert_eq!(
        S::without_trailing_sep(&units),
        U::encode(trimmed),
        "{path:?}"
    );

    let has_parent = names.len() > usize::from(!parsed.is_absolute());
    assert_eq!(
        S::dirname(&units).map(S::without_trailing_sep),
        has_parent
            .then(|| U::encode(model::parent::<S>(path)))
            .as_deref(),
        "{path:?}"
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
        let joined = GenericPath::<VecBackend, S>::join(&parts);
        assert_eq!(text(&joined), actual::<S>(&a, &Op::Join(rest.clone())));
        let resolved = GenericPath::<VecBackend, S>::resolve(&parts);
        assert!(
            model::eq_path::<S>(text(&resolved), &actual::<S>(&a, &Op::Resolve(rest))),
            "{a:?} {b:?} {c:?}"
        );
        let pushed = [&a, &b, &c].iter().fold(String::new(), |path, part| {
            actual::<S>(&path, &Op::Push(part.to_string()))
        });
        assert_eq!(
            text(&GenericPath::<VecBackend, S>::from_parts(&parts)),
            pushed
        );

        let (from, to) = (a.clone() + &b, a.clone() + &c);
        let relative = GenericPath::<VecBackend, S>::relative(from.as_bytes(), to.as_bytes());
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

        let mut path = GenericPath::<VecBackend, S>::from(a.as_bytes());
        drop(path.push_scoped(b.as_bytes()));
        assert_eq!(text(&path), a);
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
for_each_style!(posix: Posix, windows: Windows, loose_on_posix: LooseOnPosix, loose_on_windows: LooseOnWindows);

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
            let joined = actual::<Windows>(base, &Op::Join(rest.clone()));
            let prefixed = actual::<Windows>(&joined, &add);
            assert_eq!(
                actual::<Windows>(&actual::<Windows>(base, &add), &Op::Join(rest.clone())),
                prefixed
            );
            assert_eq!(actual::<Windows>(&prefixed, &add), prefixed);
            assert_eq!(actual::<Windows>(&prefixed, &Op::StripNtPrefix), joined);
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
        ("C:/foo", r"\\?\C:\foo"),
        ("//foo//bar/baz", r"\\?\UNC\foo\bar\baz"),
        (r"\\?\foo", r"\\?\foo"),
        (r"\\.\pipe\somepipe", r"\\.\pipe\somepipe"),
    ] {
        assert_eq!(actual::<Windows>(path, &Op::MakeLongPath), expected);
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
    ] {
        assert_eq!(actual::<Windows>("", &Op::Resolve(owned(all))), expected);
    }
    let across_shares = Op::Relative(r"\\s\a\x".into(), r"\\s\b\y".into());
    assert_eq!(actual::<Windows>("", &across_shares), r"\\s\b\y");
    assert_eq!(Windows::dirname(br"\\?\UNC\s\h"), None);
}

#[test]
fn case_insensitive_only_on_windows() {
    let relative = Op::Relative("c:/a".into(), "C:/b".into());
    assert_eq!(actual::<LooseOnWindows>("", &relative), "../b");
    assert_eq!(actual::<LooseOnPosix>("", &relative), "C:/b");
    assert_eq!(
        LooseOnWindows::strip_prefix(b"c:/a", b"C:/"),
        Some(&b"a"[..])
    );
    assert_eq!(LooseOnPosix::strip_prefix(b"c:/a", b"C:/"), None);
}

#[test]
fn resolve_any_sep_keeps_backslash_in_known_dir_names() {
    for (part, expected) in [
        (r"/x/a\A/y\z", r"/x/a\A/y/z"),
        (r"/x\y/../a\A\a\z", r"/x/a\A\a/z"),
        (r"/a\A\..\z", "/z"),
        (r"/a\Az", "/a/Az"),
        (r"/z\a\A", "/z/a/A"),
        (r"a\A", r"/x\y/a/A"),
    ] {
        let resolve = Op::ResolveAnySep(vec![part.into()]);
        assert_eq!(actual::<Posix>(r"/x\y", &resolve), expected);
    }
}

#[test]
fn wide_paths_have_no_known_dir_names() {
    let path = GenericPath::<VecBackend<u16>, Posix>::resolve_any_sep(&[br"/x/a\A"]);
    assert_eq!(path.as_slice(), u16::encode("/x/a/A"));
}

#[test]
#[cfg(unix)]
fn resolve_path_join_abs_keeps_trailing_slash() {
    for (cwd, parts, expected) in [
        ("/a", &["b/"][..], "/a/b/"),
        ("/a", &["b/", ""], "/a/b/"),
        ("/a", &["b/../"], "/a/"),
        ("/a", &["/b/"], "/b/"),
        ("/a", &["../"], "/"),
        ("/a/", &[""], "/a/"),
        ("/a/", &["."], "/a"),
        ("/a/", &["b/.."], "/a"),
        ("/a/", &[r"b\"], "/a/b"),
    ] {
        let parts: Vec<&[u8]> = parts.iter().map(|part| part.as_bytes()).collect();
        let joined = crate::resolve_path::join_abs_string::<Posix>(cwd.as_bytes(), &parts);
        assert_eq!(text(joined), expected, "{cwd} {parts:?}");
    }
}

#[test]
#[cfg(unix)]
fn resolve_path_relative_handles_known_dir_names() {
    for (from, to, expected) in [
        (r"/x/a\A/q", r"/x/f", "../../f"),
        (r"/x/a\A/q", r"/x/a/A/q/f", "f"),
        (r"/x/a/A/q", r"/x/a\A/q/f", "f"),
        (r"/x/a\A/q", r"/x/a/B", "../../a/B"),
        (r"/x/a\A/q", r"/x/a/AB", "../../a/AB"),
        (r"/x/q", r"/x/a\A/f", "../a/A/f"),
        (r"/x/a\", r"/x/a", "../a"),
        (r"/x/a\", r"/x/a/", ""),
    ] {
        let relative = crate::resolve_path::relative(from.as_bytes(), to.as_bytes());
        assert_eq!(text(relative), expected, "{from} {to}");
    }
}

#[test]
#[cfg(unix)]
fn without_trailing_any_sep_keeps_known_backslash() {
    use crate::string_paths::without_trailing_any_sep as trim;
    assert_eq!(trim(br"/a\//"), br"/a\");
    assert_eq!(trim(br"./a\/"), b"./a");
    assert_eq!(trim(br"/a\\/"), br"/a\");
    assert_eq!(trim(br"/bc\/\\\"), br"/bc\/\");
    assert_eq!(trim(br"/bc\\/"), b"/bc");
    assert_eq!(trim(b"//"), b"/");
    assert_eq!(trim(b""), b"");
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
    let narrow = GenericPath::<VecBackend, Posix>::from(&lone);
    assert_eq!(narrow.as_slice(), b"a\xED\xA0\x80/\xED\xB0\x80");
    assert_eq!(
        GenericPath::<VecBackend<u16>, Posix>::from(&narrow).as_slice(),
        lone
    );
    let invalid = GenericPath::<VecBackend<u16>, Posix>::from(b"\x80\xFF\xE4\xB8");
    assert_eq!(invalid.as_slice(), [0xFFFD; 4]);

    let mut exact = GenericPath::<StackBackend<9>, Posix>::new();
    assert_eq!(exact.set(&lone), Ok(()));
    assert_eq!(exact.extend_from_slice(&[0xD800u16]), Err(NameTooLong));
    assert_eq!(exact.as_slice(), narrow.as_slice());
    let mut buffer = [0u16; 3];
    let mut exact = GenericPath::<SliceBackend<'_, u16>, Posix>::new(&mut buffer);
    assert_eq!(exact.set("世世".as_bytes()), Ok(()));
    assert_eq!(exact.set(b"\x80\x80\x80"), Err(NameTooLong));
    assert_eq!(exact.as_slice(), u16::encode("世世"));
}

fn check_pool_limit<U: Unit>(limit: usize) {
    let name = vec![U::from_u8(b'a'); limit];
    let mut fixed = GenericPath::<PoolBackend<U>, Posix>::from(&name[..limit - 3]).unwrap();
    assert_eq!(fixed.push(b"bc"), Err(NameTooLong));
    assert_eq!(fixed.push(b"b"), Ok(()));
    assert_eq!(fixed.len(), limit - 1);
    assert!(is_terminated(&fixed));
    assert!(GenericPath::<PoolBackend<U>, Posix>::from(&name).is_err());
    let collapsed =
        GenericPath::<PoolBackend<U>, Posix>::join(&[&name, &U::encode("../b")]).unwrap();
    assert_eq!(collapsed.as_slice(), U::encode("b"));

    let mut grown = GenericPath::<PoolOrVecBackend<U>, Posix>::from(&name[..limit - 3]);
    grown.push(b"b");
    {
        let mut scope = grown.push_scoped(b"c");
        assert_eq!(scope.len(), limit + 1);
        scope.push(&name);
        scope.push(&name);
        assert_eq!(scope.len(), 3 * limit + 3);
        assert!(is_terminated(&scope));
    }
    assert_eq!(grown.as_slice(), fixed.as_slice());
    assert!(is_terminated(&grown));
    assert_eq!(
        GenericPath::<PoolOrVecBackend<U>, Posix>::from(&name).as_slice(),
        name
    );
}

#[test]
fn pool_fails_at_limit_and_pool_or_vec_grows() {
    check_pool_limit::<u8>(MAX_PATH_BYTES);
    if cfg!(not(miri)) {
        check_pool_limit::<u16>(PATH_MAX_WIDE);
    }
}

fn check_stack<S: PathStyle, U: Unit, const N: usize>(fits: bool) {
    type Edit<S, U, const N: usize> =
        fn(&mut GenericPath<StackBackend<N, U>, S>) -> Result<(), NameTooLong>;
    const LONG: &[u8] = b"a/../b/../c";
    let edits: [Edit<S, U, N>; 8] = [
        |path| path.set(LONG),
        |path| path.extend_from_slice(LONG),
        |path| write!(path, "{}", text(LONG)),
        |path| path.push(LONG),
        |path| path.push_any_sep(LONG),
        |path| path.push_fmt(format_args!("{}", text(LONG))),
        |path| path.try_join(&[LONG]),
        |path| path.resolve_any_sep_in_place(&[LONG]),
    ];
    init_cwd();
    let allocations = ALLOCATIONS.get();
    for edit in edits {
        let mut path = GenericPath::<StackBackend<N, U>, S>::new();
        path.set(b"..").unwrap();
        assert_eq!(edit(&mut path).is_ok(), fits);
        assert!(fits || path.as_slice() == U::lit(b".."));
        assert!(is_terminated(&path));
    }
    let to = br"/b\a".map(U::from_u8);
    let relative = GenericPath::<StackBackend<N, U>, S>::relative(U::lit(b"//"), U::lit(b".."));
    assert_eq!(relative.is_ok(), fits);
    let relative = GenericPath::<StackBackend<N, U>, S>::relative_any_sep(U::lit(b"//"), &to);
    assert_eq!(relative.is_ok(), fits);
    assert_eq!(ALLOCATIONS.get(), allocations);
}

#[test]
fn stack_does_not_allocate() {
    check_stack::<Posix, u8, 8>(false);
    check_stack::<Posix, u8, 64>(true);
    check_stack::<Windows, u16, 8>(false);
    check_stack::<Windows, u16, 64>(true);
}

#[test]
fn empty_paths_are_nul_terminated() {
    assert!(is_terminated(&Path::new()));
    assert!(is_terminated(&PoolPath::new()));
    assert!(is_terminated(&VecPath::new()));
    assert!(is_terminated(&StackPath::<1>::new()));
    assert!(VecPath::new().into_vec().is_empty());
    assert!(VecPath::new().as_mut_slice().is_empty());
    let mut empty = SlicePath::new(&mut []);
    assert_eq!(empty.push(b"a"), Err(NameTooLong));
    assert!(empty.into_zstr().as_bytes_with_nul() == b"\0");
}

#[test]
fn pooled_buffer_is_reused_without_stale_bytes() {
    let first = Path::from(b"/secret/token");
    let address = first.as_ptr();
    drop(first);
    let mut second = Path::from(b"a");
    assert_eq!(second.as_ptr(), address);
    second.truncate(13);
    assert_eq!(second.as_bytes_with_nul(), b"a\0");
    std::thread::spawn(move || drop(second)).join().unwrap();
}

#[test]
fn vec_path_moves_out_without_a_copy() {
    let path = VecPath::from(b"abc");
    let address = path.as_ptr();
    let vec = path.into_vec();
    assert_eq!(vec.as_ptr().cast(), address);
    assert_eq!(vec, b"abc");
    assert_eq!(vec.capacity(), 4);
    assert_eq!(
        VecPath::from(b"abc").into_zbox().as_bytes_with_nul(),
        b"abc\0"
    );
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
