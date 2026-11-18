//! The shared libraries a compiled executable embeds (`Flags::HAS_NATIVE_LIBRARY_SET`).
//!
//! `dlopen(2)` cannot read the virtual `/$bunfs/` filesystem, so the runtime
//! writes an embedded library to disk before it loads it. A library's own
//! dependencies resolve relative to that on-disk path (`$ORIGIN`,
//! `@loader_path`, the DLL search path), so the whole set has to land in one
//! directory that mirrors the embedded layout. The writer records the set and
//! its hash once, at build time, so the runtime never has to page in and hash
//! every embedded library to find out what to write and where.

use bun_core::Environment::OperatingSystem;
use bun_core::strings;

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
    shared_library_kind(name).is_some()
}

/// The shared-library names that `os` can load: `.node` anywhere, the
/// platform's own extension, and `.so` on macOS too (dyld loads a Mach-O
/// under any name, and Python and GLib modules ship as `.so` there). A
/// package that ships every platform's prebuilt binaries embeds them all,
/// and the others are never written out.
pub fn is_shared_library_name_for(name: &[u8], os: OperatingSystem) -> bool {
    match shared_library_kind(name) {
        Some(SharedLibraryKind::Node) => true,
        Some(SharedLibraryKind::So) => matches!(
            os,
            OperatingSystem::Linux | OperatingSystem::Freebsd | OperatingSystem::Mac
        ),
        Some(SharedLibraryKind::Dylib) => os == OperatingSystem::Mac,
        Some(SharedLibraryKind::Dll) => os == OperatingSystem::Windows,
        None => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SharedLibraryKind {
    Node,
    So,
    Dylib,
    Dll,
}

fn shared_library_kind(name: &[u8]) -> Option<SharedLibraryKind> {
    let ends_with_ignore_case = |suffix: &[u8]| {
        name.len() >= suffix.len() && name[name.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    };
    if ends_with_ignore_case(b".node") {
        return Some(SharedLibraryKind::Node);
    }
    if ends_with_ignore_case(b".dylib") {
        return Some(SharedLibraryKind::Dylib);
    }
    if ends_with_ignore_case(b".dll") {
        return Some(SharedLibraryKind::Dll);
    }
    is_versioned_so(name).then_some(SharedLibraryKind::So)
}

fn is_versioned_so(name: &[u8]) -> bool {
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

/// Where `name` (a `/$bunfs/root/...` key) lands inside the mirror directory:
/// [`MIRROR_LEVELS`], then the path relative to the root, with no empty or `.`
/// segment and every `..` segment rewritten to `_.._` (as `bun build` does for an
/// asset name), so every member stays inside the directory and sibling relations
/// hold. `None` when nothing is left of the name, or it does not fit in `buf`.
pub fn mirror_relative_path<'a>(name: &[u8], buf: &'a mut [u8]) -> Option<&'a [u8]> {
    let rel = name
        .strip_prefix(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes())
        .or_else(|| name.strip_prefix(BASE_PUBLIC_PATH.as_bytes()))
        .unwrap_or(name);
    let mut len = MIRROR_LEVELS.len();
    buf.get_mut(..len)?.copy_from_slice(MIRROR_LEVELS);
    for segment in strings::split(rel, b"/") {
        let segment = match segment {
            b"" | b"." => continue,
            b".." => b"_.._",
            other => other,
        };
        let needed = len + 1 + segment.len();
        if needed >= buf.len() {
            return None;
        }
        buf[len] = b'/';
        len += 1;
        buf[len..len + segment.len()].copy_from_slice(segment);
        len += segment.len();
    }
    (len > MIRROR_LEVELS.len()).then(|| &buf[..len])
}

/// Eight levels between the mirror directory and the layout. The temp directory above the mirror is shared, and a library steps out of its own directory with `..` (`$ORIGIN/../../lib`, or a path built in its code): eight steps above the layout stay in the mirror.
const MIRROR_LEVELS: &[u8] = b"_/_/_/_/_/_/_/_";

/// The set hash: each member's relative name and content hash, in file-table
/// order. The writer and the runtime's single-file fallback both use it, so
/// the two never disagree on a directory name.
pub fn hash_set<'a>(members: impl IntoIterator<Item = (&'a [u8], u64)>) -> u64 {
    let mut hasher = bun_wyhash::Wyhash::init(0);
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
    fn shared_library_names_per_os() {
        let linux = OperatingSystem::Linux;
        assert!(is_shared_library_name_for(b"a.node", linux));
        assert!(is_shared_library_name_for(b"libfoo.so.1", linux));
        assert!(!is_shared_library_name_for(b"foo.dll", linux));
        assert!(!is_shared_library_name_for(b"libfoo.dylib", linux));
        assert!(is_shared_library_name_for(
            b"libfoo.dylib",
            OperatingSystem::Mac
        ));
        assert!(is_shared_library_name_for(
            b"module.so",
            OperatingSystem::Mac
        ));
        assert!(is_shared_library_name_for(
            b"FOO.DLL",
            OperatingSystem::Windows
        ));
        assert!(!is_shared_library_name_for(
            b"libfoo.so",
            OperatingSystem::Windows
        ));
    }

    #[test]
    fn mirror_relative_paths() {
        fn run(name: &[u8]) -> Option<Vec<u8>> {
            let mut buf = [0u8; 256];
            mirror_relative_path(name, &mut buf).map(<[u8]>::to_vec)
        }
        fn below_the_levels(layout: &[u8]) -> Vec<u8> {
            [&b"_/_/_/_/_/_/_/_/"[..], layout].concat()
        }
        let root = BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes().to_vec();
        assert_eq!(
            run(&[&root[..], b"lib/addon.node"].concat()).unwrap(),
            below_the_levels(b"lib/addon.node")
        );
        assert_eq!(
            run(&[&root[..], b"../node_modules/a/x.node"].concat()).unwrap(),
            below_the_levels(b"_.._/node_modules/a/x.node")
        );
        assert_eq!(
            run(&[&root[..], b"./a//b.so"].concat()).unwrap(),
            below_the_levels(b"a/b.so")
        );
        assert_eq!(run(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()), None);
        assert_eq!(run(b"..").unwrap(), below_the_levels(b"_.._"));

        let levels: Vec<&[u8]> = strings::split(MIRROR_LEVELS, b"/").collect();
        assert_eq!(levels, [&b"_"[..]; 8]);

        // A result is shorter than its buffer: `a.so` below the levels is 20 bytes.
        assert_eq!(
            mirror_relative_path(b"a.so", &mut [0u8; 21]).map(<[u8]>::len),
            Some(20)
        );
        assert_eq!(mirror_relative_path(b"a.so", &mut [0u8; 20]), None);
        assert_eq!(mirror_relative_path(b"a.so", &mut [0u8; 8]), None);
    }

    #[test]
    fn set_hash_depends_on_names_and_contents() {
        let a = hash_set([(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]);
        assert_eq!(a, hash_set([(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]));
        assert_ne!(a, hash_set([(&b"lib/a.so"[..], 1), (b"lib/b.so", 3)]));
        assert_ne!(a, hash_set([(&b"lib/a.so"[..], 1), (b"other/b.so", 2)]));
        assert_ne!(a, hash_set([(&b"lib/a.so"[..], 1)]));
    }
}
