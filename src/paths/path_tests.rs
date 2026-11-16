//! `cargo test -p bun_paths`, and `bun run rust:miri -p bun_paths`.

use core::cell::Cell;
use core::fmt;

use bun_core::strings;
use bun_simdutf_sys::simdutf::{SIMDUTFResult, Status};

use crate::backend::{Out, Overflow};
use crate::path_unit::KNOWN_DIR_IN_TESTS;
use crate::platform::{Posix, Windows};
use crate::style::Volume;
use crate::style::sealed::Grammar;
use crate::{
    Backend, Borrowed, Heap, MAX_PATH_BYTES, NameTooLong, PATH_MAX_WIDE, Path, PathIn, PathUnit,
    Pool, PoolPath, SlicePath, Spill, Stack, StackPath, Style, VecPath,
};

unsafe fn slice<'a, T>(units: *const T, len: usize) -> &'a [T] {
    // SAFETY: the callers of the stand-ins pass a slice as a pointer and a length.
    unsafe { core::slice::from_raw_parts(units, len) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_untidy_slash(path: *const u8, len: usize) -> usize {
    // SAFETY: see `slice`.
    let path = unsafe { slice(path, len) };
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
    // SAFETY: see `slice`.
    strings::last_index_of_char(unsafe { slice(path, len) }, b'/').unwrap_or(len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_count_slashes(path: *const u8, len: usize) -> usize {
    // SAFETY: see `slice`.
    strings::count_char(unsafe { slice(path, len) }, b'/')
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_common_prefix_length(a: *const u8, b: *const u8, len: usize) -> usize {
    // SAFETY: see `slice`.
    let (a, b) = unsafe { (slice(a, len), slice(b, len)) };
    (0..len).find(|&at| a[at] != b[at]).unwrap_or(len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem16(h: *const u16, n: usize, nd: *const u16, k: usize) -> usize {
    // SAFETY: see `slice`.
    let (h, nd) = unsafe { (slice(h, n), slice(nd, k)) };
    (0..n)
        .find(|&at| h[at..].starts_with(nd))
        .unwrap_or(usize::MAX)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
    units: *const u16,
    len: usize,
) -> usize {
    // SAFETY: see `slice`.
    char::decode_utf16(unsafe { slice(units, len) }.iter().copied())
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
    // SAFETY: see `slice`.
    for c in char::decode_utf16(unsafe { slice(units, len) }.iter().copied()) {
        let Ok(c) = c else {
            return SIMDUTFResult {
                status: Status(6),
                count,
            };
        };
        for byte in c.encode_utf8(&mut [0; 4]).bytes() {
            // SAFETY: that the caller has reserved the room is what Miri checks here.
            unsafe { out.add(count).write(byte) };
            count += 1;
        }
    }
    SIMDUTFResult {
        status: Status::SUCCESS,
        count,
    }
}

thread_local!(static ALLOCATIONS: Cell<usize> = const { Cell::new(0) });

/// Miri rejects how `System` frees an over-aligned box on Windows.
#[cfg(not(miri))]
mod counting {
    use std::alloc::{GlobalAlloc, Layout, System};

    use super::ALLOCATIONS;

    struct Counting;

    // SAFETY: it is `System`.
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
impl Grammar for LooseOnPosix {
    const SEP: u8 = b'/';
    const LOOSE: bool = true;
    const WIN32: bool = false;
}

struct LooseOnWindows;
impl Grammar for LooseOnWindows {
    const SEP: u8 = b'/';
    const LOOSE: bool = true;
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

fn cwd() -> &'static str {
    crate::fs::FileSystem::init(b"/cwd/");
    text(crate::fs::top_level_dir())
}

#[derive(Debug, Clone)]
enum Op {
    Set(String),
    Append(String),
    WriteFmt(String, String),
    Push(String),
    PushPortable(String),
    PushFmt(String, String),
    Pop,
    SetBasename(String),
    SetExtension(String),
    ReplacePrefix(usize, String),
    EndWithSep,
    TrimTrailingSep,
    Normalize,
    Join(Vec<String>),
    Resolve(Vec<String>),
    ResolvePortable(Vec<String>),
    SetRelative(String, String),
    SetRelativePortable(String, String),
    AddLongPrefix,
    AddNtPrefix,
    RemoveWin32Prefix,
}

fn apply<B: Backend<Unit: Unit>, S: Style, C: Unit>(
    path: &mut PathIn<B, S>,
    before: &str,
    op: &Op,
) -> Out<B, ()> {
    let with_parts = |parts: &[String], run: &mut dyn FnMut(&[&[C]]) -> Out<B, ()>| {
        let parts: Vec<Vec<C>> = parts.iter().map(|part| C::encode(part)).collect();
        run(&parts.iter().map(|part| &part[..]).collect::<Vec<_>>())
    };
    match op {
        Op::Set(it) => return path.set(&C::encode(it)),
        Op::Append(it) => return path.append(&C::encode(it)),
        Op::WriteFmt(a, b) => return write!(path, "{a}{b}"),
        Op::Push(it) => return path.push(&C::encode(it)),
        Op::PushPortable(it) => return path.push_portable(&C::encode(it)),
        Op::PushFmt(a, b) => return path.push_fmt(format_args!("{a}{b}")),
        Op::SetBasename(it) => return path.set_basename(&C::encode(it)),
        Op::SetExtension(it) => return path.set_extension(&C::encode(it)),
        Op::ReplacePrefix(chars, it) => {
            let prefix: String = before.chars().take(*chars).collect();
            return path.replace_prefix(B::Unit::encode(&prefix).len(), &B::Unit::encode(it));
        }
        Op::EndWithSep => return path.end_with_sep(),
        Op::Normalize => return path.normalize(),
        Op::Join(parts) => return with_parts(parts, &mut |parts| path.join(parts)),
        Op::Resolve(parts) => return with_parts(parts, &mut |parts| path.resolve(parts)),
        Op::ResolvePortable(parts) => {
            return with_parts(parts, &mut |parts| path.resolve_portable(parts));
        }
        Op::SetRelative(from, to) => {
            return path.set_relative(&B::Unit::encode(from), &B::Unit::encode(to));
        }
        Op::SetRelativePortable(from, to) => {
            return path.set_relative_portable(&B::Unit::encode(from), &B::Unit::encode(to));
        }
        Op::AddLongPrefix => return path.add_long_prefix(),
        Op::AddNtPrefix => return path.add_nt_prefix(),
        Op::Pop => drop(path.pop()),
        Op::TrimTrailingSep => path.trim_trailing_sep(),
        Op::RemoveWin32Prefix => path.remove_win32_prefix(),
    }
    B::Error::out(Ok(()))
}

fn run<S: Style>(before: &str, op: &Op) -> String {
    cwd();
    let mut path = PathIn::<Heap, S>::from(before.as_bytes());
    apply::<_, S, u8>(&mut path, before, op);
    text(&path).to_owned()
}

/// What the operations are meant to do, in terms of lists of names.
mod model {
    use super::*;

    pub(super) struct Parsed {
        pub(super) kind: Volume,
        /// Tidy.
        pub(super) volume: String,
        pub(super) root: String,
        /// What follows the volume.
        pub(super) tail: String,
        pub(super) names: Vec<String>,
    }

    impl Parsed {
        fn has_sep(&self) -> bool {
            self.tail.len() > self.names_text().len()
        }
        fn names_text(&self) -> &str {
            let volume_len = self.root.len().min(self.root.len() - self.root_sep_len());
            &self.tail[self.root.len() - volume_len..]
        }
        fn root_sep_len(&self) -> usize {
            usize::from(self.root.ends_with(['/', '\\']) && self.tail.starts_with(['/', '\\']))
        }
        pub(super) fn is_absolute(&self) -> bool {
            self.has_sep() || matches!(self.kind, Volume::Share | Volume::Device)
        }
    }

    pub(super) fn is_sep<S: Style>(c: char) -> bool {
        c == '/' || (S::LOOSE && c == '\\')
    }

    fn sep<S: Style>() -> String {
        char::from(S::SEP).to_string()
    }

    pub(super) fn names<S: Style>(path: &str) -> Vec<String> {
        let chars: Vec<char> = path.chars().collect();
        let names = chars
            .split(|&c| is_sep::<S>(c))
            .filter(|name| !name.is_empty());
        names.map(String::from_iter).collect()
    }

    fn with_seps<S: Style>(path: &str) -> String {
        let write = |c| {
            if is_sep::<S>(c) {
                char::from(S::SEP)
            } else {
                c
            }
        };
        path.chars().map(write).collect()
    }

    pub(super) fn parse<S: Style>(path: &str) -> Parsed {
        let chars: Vec<char> = path.chars().collect();
        let sep_at = |at: usize| chars.get(at).is_some_and(|&c| is_sep::<S>(c));
        let all = names::<S>(path);
        let is_double = S::WIN32 && sep_at(0) && sep_at(1) && chars.len() > 2 && !sep_at(2);
        let is_nt = S::SEP == b'\\' && (path == r"\??" || path.starts_with(r"\??\"));
        let is_drive = S::LOOSE
            && !sep_at(0)
            && chars.get(1) == Some(&':')
            && chars[0].len_utf16() == 1
            && (S::WIN32 || sep_at(2));

        let (kind, volume, volume_len) = if is_double || is_nt {
            let is_device = is_nt || all[0] == "." || all[0] == "?";
            let is_unc = all.get(1).is_some_and(|it| it.eq_ignore_ascii_case("unc"));
            let count = all.len().min(if is_device && is_unc { 4 } else { 2 });
            let ends = (1..=chars.len())
                .filter(|&at| !sep_at(at - 1) && (sep_at(at) || at == chars.len()));
            (
                if is_device {
                    Volume::Device
                } else {
                    Volume::Share
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
            (Volume::Drive, format!("{letter}:"), 2)
        } else {
            (Volume::None, String::new(), 0)
        };
        let tail = String::from_iter(&chars[volume_len..]);
        Parsed {
            kind,
            volume,
            root: String::from_iter(&chars[..volume_len + usize::from(sep_at(volume_len))]),
            names: names::<S>(&tail),
            tail,
        }
    }

    fn guarded<S: Style>(before: &Parsed, mut path: String) -> String {
        if before.kind == Volume::None && parse::<S>(&path).kind != Volume::None {
            path.insert_str(before.root.len(), &format!(".{}", sep::<S>()));
        }
        path
    }

    fn reduced(parsed: &Parsed) -> Vec<String> {
        let mut kept: Vec<String> = Vec::new();
        for name in &parsed.names {
            if name == ".." && kept.last().is_some_and(|last| last != "..") {
                kept.pop();
            } else if name != "." && !(name == ".." && parsed.is_absolute()) {
                kept.push(name.clone());
            }
        }
        kept
    }

    fn render<S: Style>(parsed: &Parsed) -> String {
        let mut kept = reduced(parsed);
        if kept.is_empty() && !parsed.is_absolute() {
            kept.push(".".into());
        }
        let mut path = parsed.volume.clone();
        if parsed.has_sep() || parsed.kind == Volume::Share {
            path += &sep::<S>();
        }
        path += &kept.join(&sep::<S>());
        if !kept.is_empty() && parsed.tail.ends_with(is_sep::<S>) {
            path += &sep::<S>();
        }
        guarded::<S>(parsed, path)
    }

    /// `path` with the root of a path that has no volume.
    fn without_volume<S: Style>(path: &str, is_absolute: bool) -> Parsed {
        Parsed {
            kind: Volume::None,
            volume: String::new(),
            root: path.chars().take(usize::from(is_absolute)).collect(),
            tail: path.into(),
            names: names::<S>(path),
        }
    }

    fn join<S: Style>(parts: &[&str]) -> String {
        let parts: Vec<&str> = parts.iter().copied().filter(|it| !it.is_empty()).collect();
        let first = parse::<S>(parts.first().unwrap_or(&""));
        let all = parts.join(&sep::<S>());
        render::<S>(&match first.kind {
            Volume::None => without_volume::<S>(&all, first.is_absolute()),
            _ => parse::<S>(&all),
        })
    }

    pub(super) fn is_same<S: Style>(a: &str, b: &str) -> bool {
        let (a, b) = (with_seps::<S>(a), with_seps::<S>(b));
        a == b || (S::WIN32 && a.eq_ignore_ascii_case(&b))
    }

    fn resolve_to_parsed<S: Style>(parts: &[&str]) -> Parsed {
        let parts = parts.iter().filter(|it| !it.is_empty());
        let parts: Vec<(&str, Parsed)> = parts.map(|&it| (it, parse::<S>(it))).collect();
        let raw_volume =
            |(part, parsed): &(&str, Parsed)| part[..part.len() - parsed.tail.len()].to_owned();
        let volume = parts
            .iter()
            .map(raw_volume)
            .rfind(|it| !it.is_empty())
            .unwrap_or_default();
        let is_base = |at: usize| {
            let parsed = &parts[at].1;
            parsed.is_absolute()
                || (at == 0 && parsed.kind == Volume::Drive && parsed.tail.is_empty())
        };
        let is_relevant = |at: &usize| {
            let its = raw_volume(&parts[*at]);
            its.is_empty() || with_seps::<S>(&its).eq_ignore_ascii_case(&with_seps::<S>(&volume))
        };
        let relevant: Vec<usize> = (0..parts.len()).filter(is_relevant).collect();
        let start = relevant.iter().rposition(|&at| is_base(at)).unwrap_or(0);
        let tails = relevant[start..].iter().map(|&at| &parts[at].1.tail[..]);
        let tail = tails
            .filter(|it| !it.is_empty())
            .collect::<Vec<_>>()
            .join("/");
        let is_absolute = (0..parts.len()).any(is_base);
        if volume.is_empty() {
            return without_volume::<S>(&tail, is_absolute);
        }
        let is_drive = !volume.starts_with(is_sep::<S>);
        let glue = match (is_drive, tail.is_empty()) {
            (true, _) if is_absolute => "/",
            (false, false) => &sep::<S>(),
            _ => "",
        };
        parse::<S>(&format!("{volume}{glue}{tail}"))
    }

    pub(super) fn resolve<S: Style>(parts: &[&str]) -> String {
        render::<S>(&resolve_to_parsed::<S>(parts))
    }

    fn relative<S: Style>(from: &str, to: &str) -> String {
        let [from, to] = [from, to].map(|path| resolve_to_parsed::<S>(&[cwd(), path]));
        if !is_same::<S>(&from.volume, &to.volume) {
            let path = render::<S>(&to);
            let root = parse::<S>(&path).root;
            return trimmed::<S>(&path, root.len()).into();
        }
        let (from, to) = (reduced(&from), reduced(&to));
        let common = from
            .iter()
            .zip(&to)
            .take_while(|(a, b)| is_same::<S>(a, b))
            .count();
        let mut names = vec!["..".to_owned(); from.len() - common];
        names.extend_from_slice(&to[common..]);
        guarded::<S>(&parse::<S>(""), names.join(&sep::<S>()))
    }

    fn trimmed<S: Style>(path: &str, least: usize) -> &str {
        &path[..path.trim_end_matches(is_sep::<S>).len().max(least)]
    }

    fn push<S: Style>(path: &str, part: &str, sep_is_wanted: bool) -> String {
        let parsed = parse::<S>(part);
        if path.is_empty() && !parsed.root.is_empty() {
            return guarded::<S>(
                &parsed,
                with_seps::<S>(trimmed::<S>(part, parsed.root.len())),
            );
        }
        let mut rest = trimmed::<S>(part, 0);
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
        let needs_sep = sep_is_wanted && !path.is_empty() && !path.ends_with(is_sep::<S>);
        let glue = if needs_sep { sep::<S>() } else { String::new() };
        let pushed = format!("{path}{glue}{}", with_seps::<S>(rest));
        match path.len() {
            0 | 1 => guarded::<S>(&parse::<S>(path), pushed),
            _ => pushed,
        }
    }

    /// Without the last name and the separators around it.
    pub(super) fn parent<S: Style>(path: &str) -> &str {
        let parsed = parse::<S>(path);
        let path = trimmed::<S>(path, parsed.root.len());
        let name_len = parsed.names.last().map_or(0, String::len);
        trimmed::<S>(&path[..path.len() - name_len], parsed.root.len())
    }

    pub(super) fn extension(name: &str) -> &str {
        match strings::last_index_of_char(name.as_bytes(), b'.') {
            Some(dot) if dot > 0 && name != ".." => &name[dot..],
            _ => "",
        }
    }

    fn add_namespace<S: Style>(path: &str, prefix: &str) -> String {
        if S::SEP != b'\\' {
            return path.into();
        }
        let path = join::<S>(&[path]);
        let parsed = parse::<S>(&path);
        match (parsed.kind, parsed.is_absolute(), prefix == r"\??\") {
            (Volume::Drive, true, _) | (Volume::None, true, true) => format!("{prefix}{path}"),
            (Volume::Share, ..) => format!(r"{prefix}UNC{}", &path[1..]),
            (Volume::Device, _, true) => format!(r"\??{}", &path[3..]),
            _ => path,
        }
    }

    fn remove_namespace<S: Style>(path: &str) -> String {
        let parsed = parse::<S>(path);
        if parsed.kind != Volume::Device || &path[2..3] != "?" {
            return path.into();
        }
        let inner = path[3..].trim_start_matches(is_sep::<S>);
        let volume = names::<S>(&parsed.volume);
        if volume.len() > 2 {
            let share = sep::<S>().repeat(2) + inner[3..].trim_start_matches(is_sep::<S>);
            if parse::<S>(&share).kind == Volume::Share {
                return share;
            }
        } else if parse::<S>(inner).kind == Volume::Drive && parse::<S>(inner).is_absolute() {
            return inner.into();
        }
        path.into()
    }

    fn with_known_names(path: &str) -> String {
        let is_known = |name: &str| text(KNOWN_DIR_IN_TESTS).split('/').any(|it| it == name);
        let portable = |name: &str| {
            let pieces: Vec<&str> = name.split('\\').collect();
            let kept = (1..=pieces.len()).rfind(|&n| is_known(&pieces[..n].join(r"\")));
            let (kept, written) = pieces.split_at(kept.unwrap_or(1));
            [&[&kept.join(r"\")[..]], written].concat().join("/")
        };
        path.split('/').map(portable).collect::<Vec<_>>().join("/")
    }

    fn portable(part: &String) -> String {
        match part.chars().next() {
            Some('/') => with_known_names(part),
            Some('\\') => format!("./{}", with_seps::<LooseOnPosix>(part)),
            _ => with_seps::<LooseOnPosix>(part),
        }
    }

    pub(super) fn run<S: Style>(path: &str, op: &Op) -> String {
        let with = |parts: &'_ [String], run: fn(&[&str]) -> String| {
            let mut all = vec![path];
            all.extend(parts.iter().map(|part| &part[..]));
            run(&all)
        };
        let parsed = parse::<S>(path);
        match op {
            Op::Set(it) => it.clone(),
            Op::Append(it) => format!("{path}{it}"),
            Op::WriteFmt(a, b) => format!("{path}{a}{b}"),
            Op::Push(it) => push::<S>(path, it, true),
            Op::PushPortable(it) if S::LOOSE || it.is_empty() => push::<S>(path, it, true),
            Op::PushPortable(it) if path.is_empty() && it.starts_with('/') => {
                push::<S>(path, &with_known_names(it), true)
            }
            Op::PushPortable(it) => {
                push::<S>(path, &format!("./{}", with_seps::<LooseOnPosix>(it)), true)
            }
            Op::PushFmt(a, b) => push::<S>(path, &format!("{a}{b}"), true),
            Op::Pop if parsed.names.is_empty() => path.into(),
            Op::Pop => parent::<S>(path).into(),
            Op::SetBasename(it) => {
                let follows_drive = parsed.names.len() == 1 && !parsed.is_absolute();
                push::<S>(parent::<S>(path), it, !follows_drive)
            }
            Op::SetExtension(it) => match parsed.names.last().map(|name| &name[..]) {
                None | Some("." | "..") => path.into(),
                Some(name) => {
                    let path = trimmed::<S>(path, 0);
                    format!("{}{it}", &path[..path.len() - extension(name).len()])
                }
            },
            Op::ReplacePrefix(chars, it) => it.chars().chain(path.chars().skip(*chars)).collect(),
            Op::EndWithSep if path.is_empty() || path.ends_with(is_sep::<S>) => path.into(),
            Op::EndWithSep => format!("{path}{}", sep::<S>()),
            Op::TrimTrailingSep => trimmed::<S>(path, parsed.root.len()).into(),
            Op::Normalize => join::<S>(&[path]),
            Op::Join(parts) => with(parts, join::<S>),
            Op::Resolve(parts) => with(parts, resolve::<S>),
            Op::ResolvePortable(parts) => {
                let resolved = match S::LOOSE {
                    true => with(parts, resolve::<S>),
                    false => with(&Vec::from_iter(parts.iter().map(portable)), resolve::<S>),
                };
                let last = parts.concat().pop();
                match last.is_some_and(|it| r"/\".replace(&sep::<S>(), "").contains(it)) {
                    true => run::<S>(&resolved, &Op::TrimTrailingSep),
                    false => resolved,
                }
            }
            Op::SetRelative(from, to) => relative::<S>(from, to),
            Op::SetRelativePortable(from, to) if S::LOOSE => relative::<S>(from, to),
            Op::SetRelativePortable(from, to) => {
                let relative = relative::<S>(&portable(from), &portable(to));
                reduced(&without_volume::<LooseOnPosix>(&relative, false)).join("/")
            }
            Op::AddLongPrefix => add_namespace::<S>(path, r"\\?\"),
            Op::AddNtPrefix => add_namespace::<S>(path, r"\??\"),
            Op::RemoveWin32Prefix => remove_namespace::<S>(path),
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
        match round % 26 {
            0 => Op::Set(self.path()),
            1 => Op::Append(self.path()),
            2 => Op::WriteFmt(self.path(), self.path()),
            3 => Op::Push(self.path()),
            4 => Op::PushPortable(self.path()),
            5 => Op::PushFmt(self.path(), self.path()),
            6 => Op::Pop,
            7 => Op::SetBasename(self.path()),
            8 => Op::SetExtension(self.path()),
            9 => Op::ReplacePrefix(self.below(6), self.path()),
            10 => Op::EndWithSep,
            11 => Op::TrimTrailingSep,
            12 => Op::Normalize,
            13 | 14 => Op::Join(self.paths()),
            15 | 16 => Op::Resolve(self.paths()),
            17 => Op::ResolvePortable(self.paths()),
            18 => Op::SetRelative(self.path(), self.path()),
            19 | 20 => {
                let base = self.path();
                Op::SetRelative(base.clone() + &self.path(), base + &self.path())
            }
            21 => Op::SetRelativePortable(self.path(), self.path()),
            22 => {
                let base = self.path();
                Op::SetRelativePortable(base.clone() + &self.path(), base + &self.path())
            }
            23 => Op::AddLongPrefix,
            24 => Op::AddNtPrefix,
            _ => Op::RemoveWin32Prefix,
        }
    }
}

const ROUNDS: usize = if cfg!(miri) { 4 } else { 5_000 };

fn is_terminated<B: Backend, S: Style>(path: &PathIn<B, S>) -> bool {
    // SAFETY: that this is in bounds and initialized is the invariant of `PathIn`.
    unsafe { *path.tail(usize::MAX).as_ptr() == <B::Unit as crate::PathByte>::from_u8(0) }
}

/// It works if and only if the result fits, and changes nothing otherwise.
fn check_every_capacity<S: Style, U: Unit, C: Unit>(before: &str, op: &Op, after: &str) {
    let (initial, expected) = (U::encode(before), U::encode(after));
    let mut grown = PathIn::<Heap<U>, S>::from(&initial);
    apply::<_, S, C>(&mut grown, before, op);
    assert_eq!(grown.as_slice(), expected, "{before:?} {op:?}");
    assert!(is_terminated(&grown));

    let slack = if cfg!(miri) { 2 } else { 48 };
    let around = expected.len().max(initial.len() + 1);
    for capacity in around.saturating_sub(1).max(initial.len() + 1)..around + slack {
        let mut buffer = vec![U::from_u8(b'#'); capacity + 1];
        let mut path = PathIn::<Borrowed<'_, U>, S>::new_in(&mut buffer[..capacity]);
        path.set(&initial).unwrap();
        let result = apply::<_, S, C>(&mut path, before, op);
        assert_eq!(
            result.is_ok(),
            expected.len() < capacity,
            "{before:?} {op:?} {capacity}"
        );
        let left = if result.is_ok() { &expected } else { &initial };
        assert_eq!(&**path.into_z(), left, "{before:?} {op:?} {capacity}");
        assert_eq!(buffer[left.len()], U::from_u8(0));
        assert_eq!(buffer[capacity], U::from_u8(b'#'));
    }
}

fn check_against_model<S: Style>() {
    let mut random = Random(0x9E37_79B9_7F4A_7C15);
    for round in 0..12 * ROUNDS {
        let (before, op) = (random.path(), random.op(round));
        let check = match random.below(4) {
            0 => check_every_capacity::<S, u8, u8>,
            1 => check_every_capacity::<S, u8, u16>,
            2 => check_every_capacity::<S, u16, u8>,
            _ => check_every_capacity::<S, u16, u16>,
        };
        check(&before, &op, &model::run::<S>(&before, &op));
    }
}

fn check_views<S: Style, U: Unit>(path: &str, dir: &str) {
    let (units, parsed) = (U::encode(path), model::parse::<S>(path));
    let after_drive = if parsed.kind == Volume::Drive {
        &parsed.tail
    } else {
        path
    };
    let name = &model::names::<S>(after_drive).pop().unwrap_or_default()[..];
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

    let names: Vec<Vec<U>> = parsed.names.iter().map(|name| U::encode(name)).collect();
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
    for (ups, ancestor) in S::ancestors(&units).enumerate() {
        let rest = S::strip_dir(&units, ancestor).unwrap_or_else(|| panic!("{path:?} {ups}"));
        assert!(
            rest.split(|&it| S::is_sep(it))
                .filter(|it| !it.is_empty())
                .count()
                == ups
        );
    }

    if let Some(rest) = S::strip_dir(path.as_bytes(), dir.as_bytes()).map(text) {
        assert!(path.ends_with(rest) && !rest.starts_with(model::is_sep::<S>));
        assert!(
            parsed.names.ends_with(&model::names::<S>(rest)),
            "{path:?} {dir:?}"
        );
        let both = [model::names::<S>(dir), model::names::<S>(rest)].concat();
        assert!(model::is_same::<S>(
            &both.join("/"),
            &model::names::<S>(path).join("/")
        ));
        assert_eq!(
            dir.starts_with(model::is_sep::<S>),
            path.starts_with(model::is_sep::<S>)
        );
    }
}

fn check_laws<S: Style>() {
    let mut random = Random(0x2545_F491_4F6C_DD1D);
    let kind = |path: &str| {
        let parsed = model::parse::<S>(path);
        (parsed.kind, parsed.is_absolute())
    };
    for _ in 0..ROUNDS {
        let (a, b, c) = (random.path(), random.path(), random.path());
        check_views::<S, u8>(&(a.clone() + &b), &a);
        check_views::<S, u16>(&(a.clone() + &b), &a.to_ascii_uppercase());

        let normal = run::<S>(&a, &Op::Normalize);
        assert_eq!(run::<S>(&normal, &Op::Normalize), normal, "{a:?}");
        assert_eq!(kind(&normal), kind(&a), "{a:?}");

        let parts = [a.as_bytes(), b.as_bytes(), c.as_bytes()];
        let rest = vec![b.clone(), c.clone()];
        let joined = PathIn::<Heap, S>::joined(&parts);
        assert_eq!(text(&joined), run::<S>(&a, &Op::Join(rest.clone())));
        let resolved = PathIn::<Heap, S>::resolved(&parts);
        assert!(
            model::is_same::<S>(text(&resolved), &run::<S>(&a, &Op::Resolve(rest))),
            "{a:?} {b:?} {c:?}"
        );
        let pushed = [&a, &b, &c].iter().fold(String::new(), |path, part| {
            run::<S>(&path, &Op::Push(part.to_string()))
        });
        assert_eq!(text(&PathIn::<Heap, S>::from_parts(&parts)), pushed);

        let (from, to) = (a.clone() + &b, a.clone() + &c);
        let relative = PathIn::<Heap, S>::relative(from.as_bytes(), to.as_bytes());
        let [arrived, wanted] = [&[cwd(), &from, text(&relative)][..], &[cwd(), &to]]
            .map(|parts| run::<S>(&model::resolve::<S>(parts), &Op::EndWithSep));
        let is_on_no_volume = kind(&wanted).0 == Volume::None && kind(&arrived).0 != Volume::None;
        assert!(
            is_on_no_volume || model::is_same::<S>(&arrived, &wanted),
            "{from:?} {to:?}"
        );

        let mut path = PathIn::<Heap, S>::from(a.as_bytes());
        drop(path.child(b.as_bytes()));
        drop(path.prefix(random.below(8)));
        assert_eq!(text(&path), a);
    }
}

macro_rules! for_each_style {
    ($($name:ident: $style:ty),*) => {$(
        mod $name {
            use super::*;
            #[test]
            fn follows_the_model_at_every_capacity() {
                check_against_model::<$style>();
            }
            #[test]
            fn laws() {
                check_laws::<$style>();
            }
        }
    )*};
}
for_each_style!(posix: Posix, windows: Windows, loose_on_posix: LooseOnPosix, loose_on_windows: LooseOnWindows);

/// `RtlDetermineDosPathNameType_U`, and `\??\`, which is looked for first, or its start.
fn kind_to_win32(path: &str) -> &'static str {
    let path: Vec<u16> = path.encode_utf16().collect();
    let is = |at: usize, set: &str| set.encode_utf16().any(|it| path.get(at) == Some(&it));
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
fn win32_sees_the_same_kind_of_path_after() {
    let mut random = Random(0xD1B5_4A32_D192_ED03);
    for _ in 0..ROUNDS {
        let (a, b) = (random.path(), random.path());
        let has_no_server = kind_to_win32(&a) == "unc" && Windows::root(a.as_bytes()).len() == 1;
        let kind = if has_no_server {
            "rooted"
        } else {
            kind_to_win32(&a)
        };
        assert_eq!(
            kind_to_win32(&run::<Windows>(&a, &Op::Normalize)),
            kind,
            "{a:?}"
        );
        if matches!(kind, "relative" | "rooted" | "drive" | "unc" | "device") && !a.is_empty() {
            let joined = run::<Windows>(&a, &Op::Join(vec![b.clone()]));
            assert_eq!(kind_to_win32(&joined), kind, "{a:?} {b:?}");
        }
        for root in [r"\", "x", r"C:\", r"\\s\h"] {
            let pushed = run::<Windows>(root, &Op::Push(b.clone()));
            assert_eq!(kind_to_win32(&pushed), kind_to_win32(root), "{b:?}");
        }
    }
}

#[test]
fn a_win32_prefix_is_another_spelling_of_the_same_path() {
    let mut random = Random(0xA076_1D64_78BD_642F);
    for _ in 0..ROUNDS {
        let rest = vec![random.path(), random.path()];
        for (base, add) in [
            (r"C:\a", Op::AddLongPrefix),
            (r"世:\", Op::AddNtPrefix),
            (r"\\s\h\a", Op::AddLongPrefix),
            (r"\\s\h", Op::AddNtPrefix),
        ] {
            let joined = run::<Windows>(base, &Op::Join(rest.clone()));
            let prefixed = run::<Windows>(&joined, &add);
            assert_eq!(
                run::<Windows>(&run::<Windows>(base, &add), &Op::Join(rest.clone())),
                prefixed
            );
            assert_eq!(run::<Windows>(&prefixed, &add), prefixed);
            assert_eq!(run::<Windows>(&prefixed, &Op::RemoveWin32Prefix), joined);
        }
    }
}

fn parts(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|&part| part.to_owned()).collect()
}

/// From `test-path-*.js` of Node v26.12.1.
#[test]
fn agrees_with_node() {
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
        assert_eq!(run::<Posix>(path, &Op::Normalize), expected);
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
        assert_eq!(run::<Windows>(path, &Op::Normalize), expected);
    }
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
        assert_eq!(run::<Windows>("", &Op::Join(parts(all))), expected);
    }
    for (all, expected) in [
        (&[r"C:/blah\blah", "d:/games", "C:../a"][..], r"C:\blah\a"),
        (&["C:/ignore", "C:/some/file"], r"C:\some\file"),
        (
            &["//server/share", "..", r"relative\x"],
            r"\\server\share\relative\x",
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
        assert_eq!(run::<Windows>("", &Op::Resolve(parts(all))), expected);
    }
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
            run::<Windows>("", &Op::SetRelative(from.into(), to.into())),
            expected
        );
    }
    for (path, expected) in [
        ("C:/foo", r"\\?\C:\foo"),
        ("//foo//bar/baz", r"\\?\UNC\foo\bar\baz"),
        (r"\\?\foo", r"\\?\foo"),
        (r"\\.\pipe\somepipe", r"\\.\pipe\somepipe"),
    ] {
        assert_eq!(run::<Windows>(path, &Op::AddLongPrefix), expected);
    }
}

#[test]
fn differs_from_node() {
    for (all, expected) in [
        (&[r"c:\a", "b/"][..], r"C:\a\b\"),
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
        assert_eq!(run::<Windows>("", &Op::Resolve(parts(all))), expected);
    }
    let across_shares = Op::SetRelative(r"\\s\a\x".into(), r"\\s\b\y".into());
    assert_eq!(run::<Windows>("", &across_shares), r"\\s\b\y");
    assert_eq!(Windows::dirname(br"\\?\UNC\s\h"), None);
}

#[test]
fn only_win32_has_no_case() {
    let relative = Op::SetRelative("c:/a".into(), "C:/b".into());
    assert_eq!(run::<LooseOnWindows>("", &relative), "../b");
    assert_eq!(run::<LooseOnPosix>("", &relative), "C:/b");
    assert_eq!(LooseOnWindows::strip_dir(b"c:/a", b"C:/"), Some(&b"a"[..]));
    assert_eq!(LooseOnPosix::strip_dir(b"c:/a", b"C:/"), None);
}

#[test]
fn a_backslash_stays_in_the_longest_known_name_of_an_absolute_part() {
    for (part, expected) in [
        (r"/x/a\A/y\z", r"/x/a\A/y/z"),
        (r"/x\y/../a\A\a\z", r"/x/a\A\a/z"),
        (r"/a\A\..\z", "/z"),
        (r"/a\Az", "/a/Az"),
        (r"/z\a\A", "/z/a/A"),
        (r"a\A", r"/x\y/a/A"),
    ] {
        let resolve = Op::ResolvePortable(vec![part.into()]);
        assert_eq!(run::<Posix>(r"/x\y", &resolve), expected);
    }
}

#[test]
#[cfg(unix)]
fn the_older_relative_takes_either_spelling_of_a_known_name() {
    for (from, to, expected) in [
        (r"/x/a\A/q", r"/x/f", "../../f"),
        (r"/x/a\A/q", r"/x/a/A/q/f", "f"),
        (r"/x/a/A/q", r"/x/a\A/q/f", "f"),
        (r"/x/a\A/q", r"/x/a/B", "../../a/B"),
        (r"/x/a\A/q", r"/x/a/AB", "../../a/AB"),
        (r"/x/q", r"/x/a\A/f", "../a/A/f"),
    ] {
        let relative = crate::resolve_path::relative(from.as_bytes(), to.as_bytes());
        assert_eq!(text(relative), expected, "{from} {to}");
    }
}

#[test]
#[cfg(unix)]
fn a_backslash_at_the_end_stays_in_a_known_name() {
    use crate::string_paths::without_trailing_slash_portable as trimmed;
    assert_eq!(trimmed(br"/a\//"), br"/a\");
    assert_eq!(trimmed(br"./a\/"), b"./a");
    assert_eq!(trimmed(br"/a\\/"), br"/a\");
    assert_eq!(trimmed(br"/bc\/\\\"), br"/bc\/\");
    assert_eq!(trimmed(br"/bc\\/"), b"/bc");
    assert_eq!(trimmed(b"//"), b"/");
    assert_eq!(trimmed(b""), b"");
}

#[test]
fn relative_can_be_longer_than_its_operands() {
    let up = Op::SetRelative("/a".repeat(99) + "/.", "/".into());
    assert_eq!(run::<Posix>("", &up), [".."; 99].join("/"));
    assert_eq!(run::<Windows>("", &up), [".."; 99].join(r"\"));
}

#[test]
fn transcoding_is_lossless_and_total() {
    let lone = [u16::from(b'a'), 0xD800, u16::from(b'/'), 0xDC00];
    let narrow = PathIn::<Heap, Posix>::from(&lone);
    assert_eq!(narrow.as_slice(), b"a\xED\xA0\x80/\xED\xB0\x80");
    assert_eq!(PathIn::<Heap<u16>, Posix>::from(&narrow).as_slice(), lone);
    let invalid = PathIn::<Heap<u16>, Posix>::from(b"\x80\xFF\xE4\xB8");
    assert_eq!(invalid.as_slice(), [0xFFFD; 4]);

    let mut exact = PathIn::<Stack<9>, Posix>::new();
    assert_eq!(exact.set(&lone), Ok(()));
    assert_eq!(exact.append(&[0xD800u16]), Err(NameTooLong));
    assert_eq!(exact.as_slice(), narrow.as_slice());
    let mut buffer = [0u16; 3];
    let mut exact = PathIn::<Borrowed<'_, u16>, Posix>::new_in(&mut buffer);
    assert_eq!(exact.set("世世".as_bytes()), Ok(()));
    assert_eq!(exact.set(b"\x80\x80\x80"), Err(NameTooLong));
    assert_eq!(exact.as_slice(), u16::encode("世世"));
}

fn check_pool_limit<U: Unit>(limit: usize) {
    let name = vec![U::from_u8(b'a'); limit];
    let mut fixed = PathIn::<Pool<U>, Posix>::from(&name[..limit - 3]).unwrap();
    assert_eq!(fixed.push(b"bc"), Err(NameTooLong));
    assert_eq!(fixed.push(b"b"), Ok(()));
    assert_eq!(fixed.len(), limit - 1);
    assert!(is_terminated(&fixed));
    assert!(PathIn::<Pool<U>, Posix>::from(&name).is_err());
    let collapsed = PathIn::<Pool<U>, Posix>::joined(&[&name, &U::encode("../b")]).unwrap();
    assert_eq!(collapsed.as_slice(), U::encode("b"));

    let mut spilled = PathIn::<Spill<U>, Posix>::from(&name[..limit - 3]);
    spilled.push(b"b");
    {
        let mut scope = spilled.child(b"c");
        assert_eq!(scope.len(), limit + 1);
        scope.push(&name);
        scope.push(&name);
        assert_eq!(scope.len(), 3 * limit + 3);
        assert!(is_terminated(&scope));
    }
    assert_eq!(spilled.as_slice(), fixed.as_slice());
    assert!(is_terminated(&spilled));
    assert_eq!(PathIn::<Spill<U>, Posix>::from(&name).as_slice(), name);
}

#[test]
fn pool_stops_and_spill_goes_on() {
    check_pool_limit::<u8>(MAX_PATH_BYTES);
    if cfg!(not(miri)) {
        check_pool_limit::<u16>(PATH_MAX_WIDE);
    }
}

fn check_stack<S: Style, U: Unit, const N: usize>(fits: bool) {
    type Edit<S, U, const N: usize> = fn(&mut PathIn<Stack<N, U>, S>) -> Result<(), NameTooLong>;
    const LONG: &[u8] = b"a/../b/../c";
    let edits: [Edit<S, U, N>; 10] = [
        |path| path.set(LONG),
        |path| path.append(LONG),
        |path| write!(path, "{}", text(LONG)),
        |path| path.push(LONG),
        |path| path.push_portable(LONG),
        |path| path.push_fmt(format_args!("{}", text(LONG))),
        |path| path.join(&[LONG]),
        |path| path.resolve_portable(&[LONG]),
        |path| path.set_relative(U::lit(b"//"), U::lit(b"..")),
        |path| path.set_relative_portable(U::lit(b"//"), &br"/b\a".map(U::from_u8)),
    ];
    cwd();
    let allocations = ALLOCATIONS.get();
    for edit in edits {
        let mut path = PathIn::<Stack<N, U>, S>::new();
        path.set(b"..").unwrap();
        assert_eq!(edit(&mut path).is_ok(), fits);
        assert!(fits || path.as_slice() == U::lit(b".."));
        assert!(is_terminated(&path));
    }
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
fn empty_paths_are_terminated_without_storage() {
    static EMPTY: VecPath = VecPath::new();
    assert!(
        is_terminated(&EMPTY) && is_terminated(&Path::new()) && is_terminated(&PoolPath::new())
    );
    assert!(is_terminated(&StackPath::<1>::new()));
    assert!(VecPath::new().into_vec().is_empty());
    assert!(VecPath::new().as_mut_slice().is_empty());
    assert!(!VecPath::new().pop());
    let mut nowhere = SlicePath::new_in(&mut []);
    assert_eq!(nowhere.push(b"a"), Err(NameTooLong));
    assert!(nowhere.into_z().as_bytes_with_nul() == b"\0");
}

#[test]
fn a_pooled_buffer_goes_back_and_shows_nothing_old() {
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
fn heap_moves_in_and_out_without_a_copy() {
    let mut vec = Vec::with_capacity(8);
    vec.extend_from_slice(b"ab");
    let address = vec.as_ptr();
    let mut path = VecPath::from_vec(vec);
    path.append(b"cd");
    let vec = path.into_vec();
    assert_eq!((vec.as_ptr(), &vec[..]), (address, &b"abcd"[..]));
    assert_eq!(VecPath::from(b"abc").into_vec().capacity(), 4);
    assert_eq!(
        VecPath::from(b"abc").into_zbox().as_bytes_with_nul(),
        b"abc\0"
    );
}

#[test]
fn filled_takes_the_result_from_wherever_it_is() {
    for range in [0..2, 1..3, 0..0] {
        let path = Path::filled(|buffer| {
            buffer[..4].copy_from_slice(b"abcd");
            Ok::<_, ()>(&buffer[range.clone()])
        });
        let path = path.unwrap();
        assert_eq!(path.as_slice(), &b"abcd"[range]);
        assert!(is_terminated(&path));
    }
    assert_eq!(
        Path::filled(|_| Ok::<_, ()>(b"static")).unwrap().as_slice(),
        b"static"
    );
    assert_eq!(Path::filled(|_| Err(1)).err(), Some(1));
    assert_eq!(
        Path::filled(|all| Ok::<_, ()>(all)).unwrap().len(),
        MAX_PATH_BYTES
    );
    assert!(PoolPath::filled(|all| Ok::<_, ()>(all)).unwrap().is_err());
}

#[test]
fn prefix_and_tail_are_terminated() {
    let mut path = Path::from(b"ab/cd");
    assert_eq!(path.prefix(2).as_bytes_with_nul(), b"ab\0");
    assert_eq!(path.prefix(9).as_bytes_with_nul(), b"ab/cd\0");
    assert_eq!(path.tail(3).as_bytes_with_nul(), b"cd\0");
    assert_eq!(path.as_bytes_with_nul(), b"ab/cd\0");
}

#[test]
fn a_formatter_that_ignores_an_error_leaves_no_hole() {
    struct Careless;
    impl fmt::Display for Careless {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let _ = f.write_str("too long for it");
            f.write_str("b")
        }
    }
    let mut path = StackPath::<8>::new();
    path.set(b"a").unwrap();
    assert_eq!(write!(path, "{Careless}"), Err(NameTooLong));
    assert_eq!(path.push_fmt(format_args!("{Careless}")), Err(NameTooLong));
    assert_eq!(path.as_bytes_with_nul(), b"a\0");
}
