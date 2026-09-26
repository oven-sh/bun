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

/// One embedded shared library.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeLibraryMember {
    /// Index into `StandaloneModuleGraph::files` (table order).
    pub file_index: u32,
    /// Index of the member that carries the same bytes at a deeper path, or
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

/// `.node`, `.dylib`, `.dll`, `.so`, and a versioned soname: `.so` followed by
/// digits and dots only (`libvips-cpp.so.42`, `libvips-cpp.so.8.17.3`).
pub fn is_shared_library_name(name: &[u8]) -> bool {
    if name.ends_with(b".node") || name.ends_with(b".dylib") || name.ends_with(b".dll") {
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
    fn set_hash_depends_on_names_and_contents() {
        let a = hash_set([(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]);
        assert_eq!(a, hash_set([(&b"lib/a.so"[..], 1), (b"lib/b.so", 2)]));
        assert_ne!(a, hash_set([(&b"lib/a.so"[..], 1), (b"lib/b.so", 3)]));
        assert_ne!(a, hash_set([(&b"lib/a.so"[..], 1), (b"other/b.so", 2)]));
        assert_ne!(a, hash_set([(&b"lib/a.so"[..], 1)]));
    }
}
