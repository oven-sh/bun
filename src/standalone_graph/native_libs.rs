//! The shared libraries a compiled executable embeds (`Flags::HAS_NATIVE_LIBRARY_SET`).
//!
//! `dlopen(2)` cannot read the virtual `/$bunfs/` filesystem, so the runtime
//! writes an embedded library to disk before it loads it. A library's own
//! dependencies resolve relative to that on-disk path (`$ORIGIN`,
//! `@loader_path`, the DLL search path), so the whole set has to land in one
//! directory that mirrors the embedded layout. The writer records the set and
//! its hash once, at build time, so the runtime never has to page in and hash
//! every embedded library to find out what to write and where.

use bun_core::strings;
use bun_exe_format::loader_search_climb::{self, SearchClimb, Unreadable};

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
}

/// Every embedded shared library, in file-table order.
#[derive(Default)]
pub struct NativeLibrarySet {
    pub members: Box<[NativeLibraryMember]>,
    /// [`hash_set`] over the members. Names the directory the runtime mirrors
    /// the set into, so two executables with the same libraries at the same
    /// paths share one directory and any other difference gets its own.
    pub set_hash: u64,
    /// [`mirror_depth`] of the members that are not an alias.
    pub mirror_depth: u32,
}

impl NativeLibrarySet {
    pub const NO_ALIAS: u32 = u32::MAX;

    pub fn is_empty(&self) -> bool {
        self.members.is_empty()
    }

    /// The member for file-table index `file_index`, if that file is a shared library.
    pub fn member(&self, file_index: usize) -> Option<&NativeLibraryMember> {
        let index = u32::try_from(file_index).ok()?;
        self.members.iter().find(|m| m.file_index == index)
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

/// Where `name` (a `/$bunfs/root/...` key) lands inside the mirror directory: the
/// path relative to the root, with no empty or `.` segment and every `..` segment
/// rewritten to `_.._` (as `bun build` does for an asset name), so every member
/// stays inside the directory and sibling relations hold. `None` when nothing is
/// left of the name, or it does not fit in `buf`.
pub fn mirror_relative_path<'a>(name: &[u8], depth: u32, buf: &'a mut [u8]) -> Option<&'a [u8]> {
    let mut len = 0;
    let mut push = |segment: &[u8]| -> Option<()> {
        let needed = len + usize::from(len > 0) + segment.len();
        if needed >= buf.len() {
            return None;
        }
        if len > 0 {
            buf[len] = b'/';
            len += 1;
        }
        buf[len..len + segment.len()].copy_from_slice(segment);
        len += segment.len();
        Some(())
    };
    for _ in 0..depth {
        push(MIRROR_LEVEL)?;
    }
    let mut named = false;
    for segment in layout_segments(name) {
        push(segment)?;
        named = true;
    }
    named.then(|| &buf[..len])
}

/// The name of each of the `depth` levels in front of the layout ([`mirror_depth`]).
const MIRROR_LEVEL: &[u8] = b"_";

/// The segments of `name` inside the layout.
fn layout_segments(name: &[u8]) -> impl Iterator<Item = &[u8]> {
    let rel = name
        .strip_prefix(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes())
        .or_else(|| name.strip_prefix(BASE_PUBLIC_PATH.as_bytes()))
        .unwrap_or(name);
    strings::split(rel, b"/").filter_map(|segment| match segment {
        b"" | b"." => None,
        b".." => Some(&b"_.._"[..]),
        other => Some(other),
    })
}

/// What the search paths of one library ask of the depth of its set.
pub struct MemberClimb {
    /// Directories between the layout root and the library.
    directories: u32,
    climb: Result<SearchClimb, Unreadable>,
}

impl MemberClimb {
    /// `None` for a name that [`mirror_relative_path`] has no place for.
    pub fn of(name: &[u8], contents: &[u8]) -> Option<Self> {
        let directories = layout_segments(name).count().checked_sub(1)?;
        Some(Self {
            directories: u32::try_from(directories).unwrap_or(u32::MAX),
            climb: loader_search_climb::scan(contents),
        })
    }

    /// False for a library that gives its set [`UNREADABLE_MEMBER_DEPTH`].
    pub fn is_readable(&self) -> bool {
        self.climb.is_ok()
    }
}

/// The depth a set gets for a library whose search paths cannot be read.
pub const UNREADABLE_MEMBER_DEPTH: u32 = 8;

/// Levels the layout sits below the mirror directory, whose parent is the shared temp directory, so that a search path of a member (`$ORIGIN/../../lib`) stays inside it.
pub fn mirror_depth(members: &[MemberClimb]) -> u32 {
    let below_rpath = members
        .iter()
        .filter_map(|member| member.climb.ok())
        .map(|climb| climb.below_rpath)
        .max()
        .unwrap_or(0);
    members
        .iter()
        .map(|member| match member.climb {
            Ok(climb) => climb
                .direct
                .max(
                    climb
                        .rpath
                        .map_or(0, |rpath| rpath.saturating_add(below_rpath)),
                )
                .saturating_sub(member.directories),
            Err(Unreadable) => UNREADABLE_MEMBER_DEPTH,
        })
        .max()
        .unwrap_or(0)
}

/// The set hash: each member's relative name and content hash, in file-table
/// order. The writer and the runtime's single-file fallback both use it, so
/// the two never disagree on a directory name.
pub fn hash_set<'a>(mirror_depth: u32, members: impl IntoIterator<Item = (&'a [u8], u64)>) -> u64 {
    let mut hasher = bun_wyhash::Wyhash::init(0);
    hasher.update(&mirror_depth.to_le_bytes());
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
        fn run_at(name: &[u8], depth: u32) -> Option<Vec<u8>> {
            let mut buf = [0u8; 256];
            mirror_relative_path(name, depth, &mut buf).map(<[u8]>::to_vec)
        }
        fn run(name: &[u8]) -> Option<Vec<u8>> {
            run_at(name, 0)
        }
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes().to_vec();
        assert_eq!(
            run(&[&root[..], b"lib/addon.node"].concat()).unwrap(),
            b"lib/addon.node"
        );
        assert_eq!(
            run(&[&root[..], b"../node_modules/a/x.node"].concat()).unwrap(),
            b"_.._/node_modules/a/x.node"
        );
        assert_eq!(run(&[&root[..], b"./a//b.so"].concat()).unwrap(), b"a/b.so");
        assert_eq!(run(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()), None);
        assert_eq!(run(b"..").unwrap(), b"_.._");

        assert_eq!(
            run_at(&[&root[..], b"lib/addon.node"].concat(), 2).unwrap(),
            b"_/_/lib/addon.node"
        );
        assert_eq!(run_at(b"addon.node", 1).unwrap(), b"_/addon.node");
        assert_eq!(
            run_at(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes(), 3),
            None
        );
        // 256 bytes hold 122 levels and the name, not 123.
        assert_eq!(run_at(b"addon.node", 122).unwrap().len(), 2 * 122 + 10);
        assert_eq!(run_at(b"addon.node", 123), None);
        assert_eq!(run_at(b"addon.node", u32::MAX), None);
    }

    #[test]
    fn set_hash_depends_on_names_and_contents() {
        let a = hash_set(0, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]);
        assert_eq!(a, hash_set(0, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]));
        assert_ne!(a, hash_set(0, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 3)]));
        assert_ne!(a, hash_set(0, [(&b"lib/a.so"[..], 1), (b"other/b.so", 2)]));
        assert_ne!(a, hash_set(0, [(&b"lib/a.so"[..], 1)]));
        assert_ne!(a, hash_set(1, [(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]));
    }

    fn member(name: &[u8], climb: Result<SearchClimb, Unreadable>) -> MemberClimb {
        MemberClimb {
            climb,
            ..MemberClimb::of(name, b"").unwrap()
        }
    }

    fn direct(levels: u32) -> Result<SearchClimb, Unreadable> {
        Ok(SearchClimb {
            direct: levels,
            ..SearchClimb::default()
        })
    }

    #[test]
    fn mirror_depths() {
        assert_eq!(mirror_depth(&[]), 0);
        assert!(MemberClimb::of(b"", b"").is_none());
        assert!(MemberClimb::of(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes(), b"").is_none());
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes().to_vec();
        assert_eq!(
            MemberClimb::of(&[&root[..], b"./lib//addon.node"].concat(), b"")
                .unwrap()
                .directories,
            1
        );

        // A library that is not an image asks for nothing.
        let text = MemberClimb::of(b"lib/notes.so", b"INPUT(libfoo.so.1)").unwrap();
        assert!(text.is_readable());
        assert_eq!(mirror_depth(&[text]), 0);

        assert_eq!(mirror_depth(&[member(b"addon.node", direct(0))]), 0);
        assert_eq!(mirror_depth(&[member(b"lib/addon.node", direct(1))]), 0);
        assert_eq!(mirror_depth(&[member(b"addon.node", direct(1))]), 1);
        assert_eq!(mirror_depth(&[member(b"lib/addon.node", direct(2))]), 1);
        assert_eq!(mirror_depth(&[member(b"addon.node", direct(9))]), 9);
        // sharp's five-climb entry, at the depths `--asset` puts the addon.
        for (name, depth) in [
            (&b"sharp-linux-x64.node"[..], 5),
            (b"lib/sharp-linux-x64.node", 4),
            (b"@img/sharp-linux-x64/lib/sharp-linux-x64.node", 2),
            (
                b"node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node",
                1,
            ),
            (
                b"a/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node",
                0,
            ),
        ] {
            assert_eq!(
                mirror_depth(&[member(name, direct(5))]),
                depth,
                "{}",
                bstr::BStr::new(name)
            );
        }
        // The member that reaches highest above the root decides.
        assert_eq!(
            mirror_depth(&[
                member(b"a/b/c/deep.so", direct(4)),
                member(b"lib/addon.node", direct(3)),
                member(b"lib/libfoo.so", direct(0)),
            ]),
            2
        );

        let unreadable = MemberClimb::of(b"lib/addon.node", b"\x7fELF").unwrap();
        assert!(!unreadable.is_readable());
        assert_eq!(mirror_depth(&[unreadable]), UNREADABLE_MEMBER_DEPTH);
        assert_eq!(
            mirror_depth(&[
                member(b"lib/addon.node", Err(Unreadable)),
                member(b"addon.node", direct(UNREADABLE_MEMBER_DEPTH + 3)),
            ]),
            UNREADABLE_MEMBER_DEPTH + 3
        );
    }

    #[test]
    fn mirror_depth_of_rpath_install_names() {
        let rpath = |levels: u32, below_rpath: u32| {
            Ok(SearchClimb {
                direct: 0,
                rpath: Some(levels),
                below_rpath,
            })
        };
        let names_only = |below_rpath: u32| {
            Ok(SearchClimb {
                direct: 0,
                rpath: None,
                below_rpath,
            })
        };
        assert_eq!(mirror_depth(&[member(b"lib/a.dylib", rpath(2, 0))]), 1);
        assert_eq!(mirror_depth(&[member(b"lib/a.dylib", rpath(2, 3))]), 4);
        // An `@rpath/` name of one library goes on the LC_RPATH of another.
        assert_eq!(
            mirror_depth(&[
                member(b"lib/addon.node", rpath(1, 0)),
                member(b"lib/libfoo.dylib", names_only(2)),
            ]),
            2
        );
        // No LC_RPATH of the set starts at a library: the names have nothing to add to.
        assert_eq!(mirror_depth(&[member(b"a.dylib", names_only(4))]), 0);
    }
}
