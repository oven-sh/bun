//! The shared libraries a compiled executable embeds (`Flags::HAS_NATIVE_LIBRARY_SET`).
//!
//! `dlopen(2)` cannot read the virtual `/$bunfs/` filesystem, so the runtime
//! writes an embedded library to disk before it loads it. A library's own
//! dependencies resolve relative to that on-disk path (`$ORIGIN`,
//! `@loader_path`, the DLL search path), so a library and the libraries it
//! needs have to land in one directory that mirrors the embedded layout. The
//! writer records the set, its hash, who needs whom, and how far the search
//! paths climb, once, at build time. So the runtime never has to page in and
//! parse every embedded library to find out what to write and where.

use bun_core::strings;
use bun_exe_format::loader_entries::{self, Kind};

use crate::StandaloneModuleGraph::{BASE_PUBLIC_PATH, BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX};

/// One embedded shared library.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeLibraryMember {
    /// Index into `StandaloneModuleGraph::files` (table order).
    pub file_index: u32,
    /// Index of the member read from the same source file at a deeper path, or
    /// [`NativeLibrarySet::NO_ALIAS`]. The bundler hoists a required `.node`
    /// to `[name]-[hash].node` at the root, away from the `--asset` copy that
    /// sits next to its dependencies. The runtime loads the deeper copy.
    pub alias_index: u32,
    /// Range in [`NativeLibrarySet::edges`]: the members this one needs.
    pub needed_start: u32,
    pub needed_count: u32,
}

/// Every embedded shared library, in file-table order.
#[derive(Default)]
pub struct NativeLibrarySet {
    pub members: Box<[NativeLibraryMember]>,
    /// Indexes into `members`, in `needed_start` ranges.
    pub edges: Box<[u32]>,
    /// [`hash_set`] over the members. Names the directory the runtime mirrors
    /// the set into, so two executables with the same libraries at the same
    /// paths share one directory and any other difference gets its own.
    pub set_hash: u64,
    /// How many directory levels the members' own search paths climb above the
    /// embedded root ([`origin_climb`]). The runtime nests the mirror that
    /// deep, so a climb ends inside the directory it owns.
    pub pad: u32,
}

impl NativeLibrarySet {
    pub const NO_ALIAS: u32 = u32::MAX;
    /// The deepest nesting. Each level is two bytes of every mirrored path,
    /// and macOS allows 1024. A library that climbs further is refused, at
    /// build time and at load: a smaller pad would let its search path out.
    pub const MAX_PAD: u32 = 32;

    pub fn is_empty(&self) -> bool {
        self.members.is_empty()
    }

    /// The position in `members` of file-table index `file_index`, if that file
    /// is a shared library.
    pub fn position(&self, file_index: usize) -> Option<usize> {
        let index = u32::try_from(file_index).ok()?;
        self.members.iter().position(|m| m.file_index == index)
    }

    /// The member for file-table index `file_index`, if that file is a shared library.
    pub fn member(&self, file_index: usize) -> Option<&NativeLibraryMember> {
        self.members.get(self.position(file_index)?)
    }

    /// `from` and every member it needs, directly or through another member:
    /// what the runtime has to write before the loader opens `from`. Positions
    /// in `members`, `from` first.
    pub fn closure(&self, from: usize) -> Vec<usize> {
        let mut closure = vec![from];
        let mut at = 0;
        while at < closure.len() {
            let member = &self.members[closure[at]];
            at += 1;
            let start = member.needed_start as usize;
            for &edge in &self.edges[start..start + member.needed_count as usize] {
                let edge = edge as usize;
                if !closure.contains(&edge) {
                    closure.push(edge);
                }
            }
        }
        closure
    }
}

/// `.node`, `.dylib`, `.dll` (any case), `.so`, and a versioned soname: `.so`
/// followed by digits and dots only (`libvips-cpp.so.42`, `libvips-cpp.so.8.17.3`).
pub fn is_shared_library_name(name: &[u8]) -> bool {
    let ends_with_ignore_case = |suffix: &[u8]| {
        name.len() >= suffix.len() && name[name.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    };
    if ends_with_ignore_case(b".node")
        || ends_with_ignore_case(b".dylib")
        || ends_with_ignore_case(b".dll")
    {
        return true;
    }
    let Some(so) = strings::index_of(name, b".so") else {
        return false;
    };
    let mut rest = &name[so + b".so".len()..];
    loop {
        if rest.is_empty() {
            return true;
        }
        match strings::index_of(rest, b".so") {
            // `a.so.b.so.1`: only the last `.so` decides.
            Some(next) => rest = &rest[next + b".so".len()..],
            None => break,
        }
    }
    while !rest.is_empty() {
        if rest[0] != b'.' {
            return false;
        }
        let digits = rest[1..].iter().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 {
            return false;
        }
        rest = &rest[1 + digits..];
    }
    true
}

/// The name of each directory the mirror is nested in. One byte, so `pad`
/// levels cost `pad * 2` bytes of every path the runtime hands to `dlopen`.
const PAD_SEGMENT: u8 = b'_';

/// Where `name` (a `/$bunfs/root/...` key) lands inside the mirror directory:
/// `pad` nesting directories, then the path relative to the embedded root with
/// no empty or `.` segment and every `..` segment rewritten to `_.._` (as
/// `bun build` does for an asset name). So every member stays inside the
/// directory, sibling relations hold, and a search path that climbs `pad`
/// levels or fewer stays inside the directory Bun owns. `None` when nothing is
/// left of the name, or it does not fit in `buf`.
pub fn mirror_relative_path<'a>(name: &[u8], pad: u32, buf: &'a mut [u8]) -> Option<&'a [u8]> {
    let rel = name
        .strip_prefix(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes())
        .or_else(|| name.strip_prefix(BASE_PUBLIC_PATH.as_bytes()))
        .unwrap_or(name);
    let mut len = 0;
    let mut push = |segment: &[u8], len: &mut usize| -> Option<()> {
        if *len + usize::from(*len > 0) + segment.len() >= buf.len() {
            return None;
        }
        if *len > 0 {
            buf[*len] = b'/';
            *len += 1;
        }
        buf[*len..*len + segment.len()].copy_from_slice(segment);
        *len += segment.len();
        Some(())
    };
    for _ in 0..pad {
        push(&[PAD_SEGMENT], &mut len)?;
    }
    for segment in strings::split(rel, b"/") {
        match segment {
            b"" | b"." => continue,
            b".." => push(b"_.._", &mut len)?,
            other => push(other, &mut len)?,
        }
    }
    (len > 0).then(|| &buf[..len])
}

/// The tokens that mean "the directory of this library". Not
/// `@executable_path`: that is the directory of the Bun executable, which the
/// mirror does not move.
const ORIGIN_TOKENS: [&[u8]; 3] = [b"${ORIGIN}", b"$ORIGIN", b"@loader_path"];

/// How many directory levels a loader search path reaches above the embedded
/// root, from a library whose own directory is `depth` levels below it. 0 when
/// the path stays inside, or names no token.
///
/// The loaders put the library's absolute directory where the token is, so
/// the walk starts there, wherever the token is: what comes before it can
/// resolve to `/` (`/./$ORIGIN/..`, or `lib/../$ORIGIN/..` run from `/`), and
/// then the path is the library's own. What follows the token up to the next
/// `/` only renames the library's directory (`$ORIGIN.old/x` is a sibling of
/// it): glibc wants a non-identifier character there and musl takes any, so
/// every suffix counts. The walk takes the highest point the path reaches,
/// not its end: once a path leaves the root, a later segment re-enters the
/// directory it left.
pub fn origin_climb(path: &[u8], depth: usize) -> u32 {
    origin_climb_then(path, depth, 0)
}

/// [`origin_climb`] of `path` followed by `parents` more `..` segments.
fn origin_climb_then(path: &[u8], depth: usize, parents: u32) -> u32 {
    let Some(from_token) = ORIGIN_TOKENS
        .iter()
        .filter_map(|token| strings::index_of(path, token))
        .min()
    else {
        return 0;
    };
    let mut level = i64::try_from(depth).unwrap_or(i64::MAX);
    let mut highest = level;
    for segment in strings::split(&path[from_token..], b"/").skip(1) {
        match segment {
            b"" | b"." => continue,
            b".." => level -= 1,
            // A name, or a token that expands to one or more names.
            _ => level += 1,
        }
        highest = highest.min(level);
    }
    highest = highest.min(level.saturating_sub(i64::from(parents)));
    u32::try_from(highest.saturating_neg()).unwrap_or(0)
}

/// Where a load name that carries a path of its own lands inside the mirror:
/// the path of the embedded library it names, relative to the embedded root.
/// `dir` is the carrier's own directory there. `None` when the name is not
/// relative to the carrier (a bare soname, `@rpath`, an absolute path) or
/// reaches outside the root, where no member can answer it.
pub fn needed_relative_path<'a>(dir: &[u8], name: &[u8], buf: &'a mut [u8]) -> Option<&'a [u8]> {
    let rest = ORIGIN_TOKENS
        .iter()
        .find_map(|token| name.strip_prefix(*token))?;
    if !matches!(rest.first(), Some(b'/')) {
        return None;
    }
    let mut segments: Vec<&[u8]> = strings::split(dir, b"/")
        .filter(|s| !s.is_empty())
        .collect();
    for segment in strings::split(rest, b"/") {
        match segment {
            b"" | b"." => {}
            b".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    let mut len = 0;
    for segment in segments {
        if len + usize::from(len > 0) + segment.len() >= buf.len() {
            return None;
        }
        if len > 0 {
            buf[len] = b'/';
            len += 1;
        }
        buf[len..len + segment.len()].copy_from_slice(segment);
        len += segment.len();
    }
    (len > 0).then(|| &buf[..len])
}

/// What one embedded shared library tells the dynamic loader.
#[derive(Default)]
pub struct LoaderFacts<'a> {
    /// [`origin_climb`] over every search path and load name it declares.
    pub climb: u32,
    /// The names it loads, as written: a soname (`libfoo.so.1`), or a path
    /// that starts with `@rpath`, `@loader_path` or `$ORIGIN`.
    pub needed: Vec<&'a [u8]>,
    /// Most `..` segments in one of its `@rpath/` load names.
    pub rpath_name_parents: u32,
    /// Its `LC_RPATH` entries.
    rpaths: Vec<&'a [u8]>,
    depth: usize,
}

impl LoaderFacts<'_> {
    /// `climb`, and an `@rpath/` load name with `name_parents` `..` segments
    /// joined to each of its `LC_RPATH` entries. dyld joins such a name to the
    /// entries of the image that carries it and of every image that loaded
    /// it, so `name_parents` is the most of the whole set.
    pub fn climb_below_rpaths(&self, name_parents: u32) -> u32 {
        self.rpaths
            .iter()
            .map(|rpath| origin_climb_then(rpath, self.depth, name_parents))
            .fold(self.climb, u32::max)
    }
}

/// [`LoaderFacts`] of the library in `bytes`, which the mirror puts `depth`
/// levels below its embedded root. `Ok(None)`: not a library image Bun loads
/// (an `--asset` file that only looks like one by name, or a PE, which carries
/// no search path). `Err`: a library image that contradicts itself.
pub fn loader_facts(
    bytes: &[u8],
    depth: usize,
) -> Result<Option<LoaderFacts<'_>>, loader_entries::Malformed> {
    let Some(entries) = loader_entries::read(bytes)? else {
        return Ok(None);
    };
    let mut facts = LoaderFacts {
        depth,
        ..LoaderFacts::default()
    };
    for entry in entries {
        match entry.kind {
            // An ELF entry is a list. glibc splits it at `:`, musl at `:` and
            // at a newline, so a path counts in both readings.
            Kind::ElfRpath | Kind::ElfRunpath => {
                let paths = strings::split(entry.value, b":")
                    .chain(strings::split_any(entry.value, b":\n"));
                for path in paths {
                    facts.climb = facts.climb.max(origin_climb(path, depth));
                }
            }
            Kind::MachoRpath => {
                facts.climb = facts.climb.max(origin_climb(entry.value, depth));
                facts.rpaths.push(entry.value);
            }
            // A load name can carry a path of its own, and the loaders expand
            // the same tokens in it.
            Kind::ElfNeeded | Kind::ElfAuxiliary | Kind::ElfFilter | Kind::MachoDylib => {
                facts.climb = facts.climb.max(origin_climb(entry.value, depth));
                if let Some(below) = entry.value.strip_prefix(b"@rpath/") {
                    let parents = strings::split(below, b"/")
                        .filter(|segment| *segment == b"..")
                        .count();
                    facts.rpath_name_parents = facts
                        .rpath_name_parents
                        .max(u32::try_from(parents).unwrap_or(u32::MAX));
                }
                facts.needed.push(entry.value);
            }
            Kind::ElfSoname | Kind::MachoId => {}
        }
    }
    Ok(Some(facts))
}

/// The set hash: the pad and then each member's relative name and content
/// hash, in file-table order. The writer and the runtime's single-file
/// fallback both use it, so the two never disagree on a directory name, and
/// the pad is in the name, so one layout of a set never has to be repaired
/// into another.
pub fn hash_set<'a>(pad: u32, members: impl IntoIterator<Item = (&'a [u8], u64)>) -> u64 {
    let mut hasher = bun_wyhash::Wyhash::init(0);
    hasher.update(&pad.to_le_bytes());
    for (name, content_hash) in members {
        hasher.update(&(name.len() as u32).to_le_bytes());
        hasher.update(name);
        hasher.update(&content_hash.to_le_bytes());
    }
    hasher.final_()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_library_names() {
        for name in [
            &b"addon.node"[..],
            b"lib/addon.node",
            b"libfoo.so",
            b"libvips-cpp.so.42",
            b"libvips-cpp.so.8.17.3",
            b"lib/libfoo.dylib",
            b"foo.dll",
            b"OCI.DLL",
        ] {
            assert!(is_shared_library_name(name), "{}", bstr::BStr::new(name));
        }
        for name in [
            &b"app.js"[..],
            b"README.so.txt",
            b"libfoo.so.",
            b"data.json",
            b"notes.sock",
            b"x.so.1a",
        ] {
            assert!(!is_shared_library_name(name), "{}", bstr::BStr::new(name));
        }
    }

    #[test]
    fn mirror_relative_paths() {
        fn run(name: &[u8], pad: u32) -> Option<Vec<u8>> {
            let mut buf = [0u8; 256];
            mirror_relative_path(name, pad, &mut buf).map(<[u8]>::to_vec)
        }
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes().to_vec();
        assert_eq!(
            run(&[&root[..], b"lib/addon.node"].concat(), 0).unwrap(),
            b"lib/addon.node"
        );
        assert_eq!(
            run(&[&root[..], b"lib/addon.node"].concat(), 2).unwrap(),
            b"_/_/lib/addon.node"
        );
        assert_eq!(
            run(&[&root[..], b"../node_modules/a/x.node"].concat(), 1).unwrap(),
            b"_/_.._/node_modules/a/x.node"
        );
        assert_eq!(
            run(&[&root[..], b"./a//b.so"].concat(), 0).unwrap(),
            b"a/b.so"
        );
        assert_eq!(
            run(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes(), 0),
            None
        );
        assert_eq!(run(b"..", 0).unwrap(), b"_.._");
        // The pad alone is not a path to a file.
        assert_eq!(
            run(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes(), 2).unwrap(),
            b"_/_"
        );
        let mut small = [0u8; 8];
        assert_eq!(mirror_relative_path(b"lib/addon.node", 0, &mut small), None);
    }

    #[test]
    fn origin_climbs() {
        // From the mirror's root, one level up leaves it.
        assert_eq!(origin_climb(b"$ORIGIN", 0), 0);
        assert_eq!(origin_climb(b"$ORIGIN/lib", 0), 0);
        assert_eq!(origin_climb(b"$ORIGIN/../lib", 0), 1);
        assert_eq!(origin_climb(b"${ORIGIN}/../lib", 0), 1);
        assert_eq!(origin_climb(b"@loader_path/../../lib", 0), 2);
        // One directory below the root absorbs one level.
        assert_eq!(origin_climb(b"$ORIGIN/../lib", 1), 0);
        assert_eq!(origin_climb(b"$ORIGIN/../../lib", 1), 1);
        // sharp's fifth entry, from `node_modules/@img/sharp-linux-x64/lib`.
        assert_eq!(
            origin_climb(
                b"$ORIGIN/../../../../../@img-sharp-libvips-linux-x64/node_modules/@img/sharp-libvips-linux-x64/lib",
                4
            ),
            1
        );
        // The highest point counts, not the end.
        assert_eq!(origin_climb(b"$ORIGIN/../../a/b", 0), 2);
        // No token: not a path from the library.
        assert_eq!(origin_climb(b"/opt/lib", 0), 0);
        assert_eq!(origin_climb(b"lib/../..", 0), 0);
        assert_eq!(origin_climb(b"", 0), 0);
        assert_eq!(origin_climb(b"..", 0), 0);
        assert_eq!(origin_climb(b"@executable_path/../lib", 0), 0);
        // The token is an absolute path, so what stands in front of it can
        // lead back to `/`. The walk starts at the token.
        assert_eq!(origin_climb(b"/$ORIGIN/../lib", 0), 1);
        assert_eq!(origin_climb(b"./$ORIGIN/../../lib", 0), 2);
        assert_eq!(origin_climb(b"lib/../$ORIGIN/..", 0), 1);
        assert_eq!(origin_climb(b".$ORIGIN/../..", 1), 1);
        assert_eq!(origin_climb(b"/opt/${ORIGIN}/../..", 0), 2);
        // What follows the token renames the library's directory: a sibling,
        // at the same level. musl reads `$ORIGINAL` that way too.
        assert_eq!(origin_climb(b"$ORIGIN.old/lib", 0), 0);
        assert_eq!(origin_climb(b"$ORIGIN.old/../lib", 0), 1);
        assert_eq!(origin_climb(b"${ORIGIN}old/../../lib", 1), 1);
        assert_eq!(origin_climb(b"$ORIGINAL/../lib", 0), 1);
        assert_eq!(origin_climb(b"@loader_pathx/../..", 0), 2);
        // `$LIB` and `$PLATFORM` are names.
        assert_eq!(origin_climb(b"$ORIGIN/$LIB/../../x", 0), 1);
        // The true number, however large: the caller refuses what it cannot nest.
        assert_eq!(
            origin_climb(&[&b"$ORIGIN"[..], &b"/..".repeat(64)].concat(), 3),
            61
        );
    }

    /// A 64-bit little-endian ELF image with one `PT_LOAD` over the whole
    /// file and these dynamic strings.
    fn elf_with(entries: &[(i64, &[u8])]) -> Vec<u8> {
        const EHDR: usize = 64;
        const PHDR: usize = 56;
        const VADDR: u64 = 0x1000;
        let mut strtab = vec![0u8];
        let mut dynamic: Vec<(i64, u64)> = Vec::new();
        for (tag, value) in entries {
            dynamic.push((*tag, strtab.len() as u64));
            strtab.extend_from_slice(value);
            strtab.push(0);
        }
        let dynamic_at = EHDR + 2 * PHDR;
        let strtab_at = dynamic_at + (dynamic.len() + 3) * 16;
        dynamic.push((5, VADDR + strtab_at as u64));
        dynamic.push((10, strtab.len() as u64));
        dynamic.push((0, 0));
        let mut image = vec![0u8; strtab_at + strtab.len()];
        image[..6].copy_from_slice(b"\x7fELF\x02\x01");
        image[32..40].copy_from_slice(&(EHDR as u64).to_le_bytes());
        image[54..56].copy_from_slice(&(PHDR as u16).to_le_bytes());
        image[56..58].copy_from_slice(&2u16.to_le_bytes());
        let total = image.len() as u64;
        let mut phdr = |index: usize, kind: u32, offset: u64, size: u64| {
            let at = EHDR + index * PHDR;
            image[at..at + 4].copy_from_slice(&kind.to_le_bytes());
            image[at + 8..at + 16].copy_from_slice(&offset.to_le_bytes());
            image[at + 16..at + 24].copy_from_slice(&(VADDR + offset).to_le_bytes());
            image[at + 32..at + 40].copy_from_slice(&size.to_le_bytes());
        };
        phdr(0, 1, 0, total);
        phdr(1, 2, dynamic_at as u64, (dynamic.len() * 16) as u64);
        for (index, (tag, value)) in dynamic.iter().enumerate() {
            let at = dynamic_at + index * 16;
            image[at..at + 8].copy_from_slice(&tag.to_le_bytes());
            image[at + 8..at + 16].copy_from_slice(&value.to_le_bytes());
        }
        image[strtab_at..].copy_from_slice(&strtab);
        image
    }

    /// A 64-bit Mach-O image with these `rpath_command`s and `dylib_command`s.
    fn macho_with(commands: &[(u32, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for &(cmd, string) in commands {
            let size = (24 + string.len() + 1).next_multiple_of(8);
            let start = body.len();
            body.extend_from_slice(&cmd.to_le_bytes());
            body.extend_from_slice(&(size as u32).to_le_bytes());
            body.extend_from_slice(&24u32.to_le_bytes());
            body.resize(start + 24, 0);
            body.extend_from_slice(string);
            body.resize(start + size, 0);
        }
        let mut image = vec![0u8; 32];
        image[..4].copy_from_slice(&0xfeed_facfu32.to_le_bytes());
        image[16..20].copy_from_slice(&(commands.len() as u32).to_le_bytes());
        image[20..24].copy_from_slice(&(body.len() as u32).to_le_bytes());
        image.extend_from_slice(&body);
        image
    }

    #[test]
    fn loader_facts_of_a_library() {
        const DT_NEEDED: i64 = 1;
        const LC_LOAD_DYLIB: u32 = 0xc;
        const LC_RPATH: u32 = 0x8000_001c;
        const DT_RPATH: i64 = 15;
        const DT_RUNPATH: i64 = 29;

        // The deepest entry of a list decides, and a name the loader opens is kept as written.
        let image = elf_with(&[
            (DT_NEEDED, b"libfoo.so.1"),
            (DT_RUNPATH, b"$ORIGIN:$ORIGIN/../../lib:/usr/lib"),
        ]);
        let facts = loader_facts(&image, 1).unwrap().unwrap();
        assert_eq!(facts.climb, 1);
        assert_eq!(facts.needed, [&b"libfoo.so.1"[..]]);

        // A path inside a load name counts like a search path.
        let image = elf_with(&[(DT_NEEDED, b"$ORIGIN/../../lib/libdep.so")]);
        assert_eq!(loader_facts(&image, 0).unwrap().unwrap().climb, 2);

        // musl ends a path at a newline too.
        let image = elf_with(&[(DT_RPATH, b"lib\n$ORIGIN/../..")]);
        assert_eq!(loader_facts(&image, 0).unwrap().unwrap().climb, 2);
        // glibc does not: the whole piece is one path that starts at the library.
        let image = elf_with(&[(DT_RPATH, b"$ORIGIN/a\nb/../../..")]);
        assert_eq!(loader_facts(&image, 0).unwrap().unwrap().climb, 2);

        assert!(
            loader_facts(b"MZ\x90\0not an image bun reads", 0)
                .unwrap()
                .is_none()
        );

        // dyld joins an `@rpath/` name to the `LC_RPATH` entries: the name's
        // `..` segments continue where the entry ends.
        let image = macho_with(&[
            (LC_RPATH, b"@loader_path/../Frameworks"),
            (LC_LOAD_DYLIB, b"@rpath/../../lib/libfoo.dylib"),
            (LC_LOAD_DYLIB, b"@loader_path/libbar.dylib"),
        ]);
        let facts = loader_facts(&image, 1).unwrap().unwrap();
        assert_eq!(facts.climb, 0);
        assert_eq!(facts.rpath_name_parents, 2);
        assert_eq!(facts.climb_below_rpaths(0), 0);
        assert_eq!(facts.climb_below_rpaths(2), 1);
        assert_eq!(facts.climb_below_rpaths(5), 4);
        assert_eq!(
            facts.needed,
            [
                &b"@rpath/../../lib/libfoo.dylib"[..],
                b"@loader_path/libbar.dylib"
            ]
        );
        let mut cut = elf_with(&[(DT_NEEDED, b"libfoo.so.1")]);
        cut.truncate(cut.len() - 4);
        assert!(loader_facts(&cut, 0).is_err());
    }

    #[test]
    fn needed_relative_paths() {
        fn run(dir: &[u8], name: &[u8]) -> Option<Vec<u8>> {
            let mut buf = [0u8; 256];
            needed_relative_path(dir, name, &mut buf).map(<[u8]>::to_vec)
        }
        assert_eq!(run(b"lib", b"$ORIGIN/libfoo.so").unwrap(), b"lib/libfoo.so");
        assert_eq!(
            run(
                b"node_modules/a/lib",
                b"@loader_path/../../b/lib/libfoo.dylib"
            )
            .unwrap(),
            b"node_modules/b/lib/libfoo.dylib"
        );
        assert_eq!(run(b"", b"${ORIGIN}/x/libfoo.so").unwrap(), b"x/libfoo.so");
        // Outside the root: no member can answer it.
        assert_eq!(run(b"lib", b"$ORIGIN/../../libfoo.so"), None);
        // Not relative to the carrier.
        assert_eq!(run(b"lib", b"libfoo.so.1"), None);
        assert_eq!(run(b"lib", b"@rpath/libfoo.dylib"), None);
        assert_eq!(run(b"lib", b"/usr/lib/libfoo.so"), None);
        assert_eq!(run(b"lib", b"$ORIGINAL/libfoo.so"), None);
    }

    #[test]
    fn set_hash_depends_on_names_contents_and_pad() {
        let a = hash_set(0, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]);
        assert_eq!(a, hash_set(0, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]));
        assert_ne!(a, hash_set(0, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 3)]));
        assert_ne!(a, hash_set(0, [(&b"lib/a.so"[..], 1), (b"other/b.so", 2)]));
        assert_ne!(a, hash_set(0, [(&b"lib/a.so"[..], 1)]));
        assert_ne!(a, hash_set(1, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]));
    }

    #[test]
    fn closure_follows_needed_edges() {
        let member = |file_index: u32, needed_start: u32, needed_count: u32| NativeLibraryMember {
            file_index,
            alias_index: NativeLibrarySet::NO_ALIAS,
            needed_start,
            needed_count,
        };
        // 0 needs 1, 1 needs 2 and 0 back, 3 needs nobody.
        let set = NativeLibrarySet {
            members: Box::from([
                member(10, 0, 1),
                member(11, 1, 2),
                member(12, 0, 0),
                member(13, 0, 0),
            ]),
            edges: Box::from([1u32, 2, 0]),
            set_hash: 0,
            pad: 0,
        };
        assert_eq!(set.closure(0), [0, 1, 2]);
        assert_eq!(set.closure(3), [3]);
        assert_eq!(set.position(12), Some(2));
        assert_eq!(set.position(99), None);
    }
}
