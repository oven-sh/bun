use core::mem::size_of;

#[cfg(debug_assertions)]
use bun_core::strings;

// `use super::{self as lockfile, ...}` and bare `use super as lockfile;` are both
// rejected by rustc (E0432: "no `super` in the root" — rust-lang/rust#48067), so the
// parent-module alias is spelled via its crate path instead.
use super::{
    DependencyIDList, DependencyList, ExternalStringBuffer, Lockfile, PackageIDList, Stream,
    StringBuffer, Tree, assert_no_uninitialized_padding, tree,
};
use crate::lockfile_real as lockfile;
use crate::package_manager_real::package_manager_options::Options as PackageManagerOptions;
use crate::{Aligner, DependencyID, PackageID, PackageManager, dependency, invalid_package_id};

#[derive(Default)]
pub struct Buffers {
    pub(crate) trees: tree::List,
    pub hoisted_dependencies: DependencyIDList,
    /// This is the underlying buffer used for the `resolutions` external slices inside of `Package`
    /// Should be the same length as `dependencies`
    pub resolutions: PackageIDList,
    /// This is the underlying buffer used for the `dependencies` external slices inside of `Package`
    pub dependencies: DependencyList,
    /// This is the underlying buffer used for any `Semver.ExternalString` instance in the lockfile
    pub extern_strings: ExternalStringBuffer,
    /// This is where all non-inlinable `Semver.String`s are stored.
    pub string_bytes: StringBuffer,
}

// The Vec-backed field types drop automatically; no explicit `Drop` impl is
// needed.

impl Buffers {
    pub(crate) fn preallocate(&mut self, that: &Buffers) -> Result<(), bun_alloc::AllocError> {
        self.trees
            .reserve(that.trees.len().saturating_sub(self.trees.len()));
        self.resolutions.reserve(
            that.resolutions
                .len()
                .saturating_sub(self.resolutions.len()),
        );
        self.dependencies.reserve(
            that.dependencies
                .len()
                .saturating_sub(self.dependencies.len()),
        );
        self.extern_strings.reserve(
            that.extern_strings
                .len()
                .saturating_sub(self.extern_strings.len()),
        );
        self.string_bytes.reserve(
            that.string_bytes
                .len()
                .saturating_sub(self.string_bytes.len()),
        );
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `sizes` — serialized field-order table
//
// Array payloads are written in field declaration order, each aligned to
// `ALIGN_TYPE_0` (pointer alignment, NOT the element alignment).
// ──────────────────────────────────────────────────────────────────────────
mod sizes {
    use super::*;

    /// Alignment used by `Aligner::write` for every array payload.
    ///
    /// This is the alignment of a slice descriptor (a `(*T, usize)` fat
    /// pointer) — i.e. pointer alignment, not element alignment. This 8-byte
    /// boundary is load-bearing for on-disk parity AND for
    /// `read_array::<ExternalString>` (which has a `u64` field) to produce an aligned `&[T]`.
    pub(super) const ALIGN_TYPE_0: usize = align_of::<usize>();
    const _: () = assert!(ALIGN_TYPE_0 == align_of::<&[Tree]>());
}

pub(crate) fn read_array<T: Copy>(stream: &mut Stream) -> crate::Result<Vec<T>> {
    let start_pos = stream.read_int_le::<u64>()?;

    // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
    if start_pos == 0xDEAD_BEEF {
        return Err(crate::Error::CorruptLockfile);
    }

    // These are absolute numbers, it shouldn't be zero.
    // There's a prefix before any of the arrays, so it can never be zero here.
    if start_pos == 0 {
        return Err(crate::Error::CorruptLockfile);
    }

    // We shouldn't be going backwards.
    if start_pos < (stream.pos as u64).saturating_sub(size_of::<u64>() as u64) {
        return Err(crate::Error::CorruptLockfile);
    }

    let end_pos = stream.read_int_le::<u64>()?;

    // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
    // That shouldn't happen.
    if end_pos == 0xDEAD_BEEF {
        return Err(crate::Error::CorruptLockfile);
    }

    // These are absolute numbers, it shouldn't be zero.
    if end_pos == 0 {
        return Err(crate::Error::CorruptLockfile);
    }

    // Prevent integer overflow.
    if start_pos > end_pos {
        return Err(crate::Error::CorruptLockfile);
    }

    // Prevent buffer overflow.
    if end_pos > stream.buffer.len() as u64 {
        return Err(crate::Error::CorruptLockfile);
    }

    let byte_len = end_pos - start_pos;

    stream.pos = end_pos as usize;

    if byte_len == 0 {
        // Empty arrays are written by `write_array`'s else-branch without an
        // `Aligner::write_with_align` pad, so their recorded start offset need not
        // be aligned.
        return Ok(Vec::new());
    }

    if start_pos % core::mem::align_of::<T>() as u64 != 0 || byte_len % size_of::<T>() as u64 != 0 {
        return Err(crate::Error::CorruptLockfile);
    }

    let start_pos = start_pos as usize;
    let end_pos = end_pos as usize;
    // SAFETY: `start_pos..end_pos` is in-bounds (checked above) and the lockfile
    // writer aligned the payload to `align_of::<T>()` via `Aligner::write`.
    let misaligned: &[T] = unsafe {
        bun_core::ffi::slice(
            stream.buffer.as_ptr().add(start_pos).cast::<T>(),
            (end_pos - start_pos) / size_of::<T>(),
        )
    };

    Ok(misaligned.to_vec())
}

pub(crate) fn write_array<S, T>(
    stream: &mut S,
    array: &[T],
    prefix: &'static str,
) -> crate::Result<()>
where
    // One type plays both the positional-stream and append-writer roles —
    // `StreamType` impls both `PositionalStream` (get_pos/pwrite) and
    // `bun_io::Write` (append) — so there are never two `&mut` to one buffer.
    S: lockfile::PositionalStream + bun_io::Write,
{
    // This call is a zero-cost intent marker only — it carries no trait bound (see the
    // doc comment on `assert_no_uninitialized_padding`). The actual compile-time
    // enforcement is the per-type `const` field-offset asserts and the
    // `layout_asserts` size/align pins in src/install/padding_checker.rs; any new
    // `T` serialized through here must be added to that audit.
    assert_no_uninitialized_padding(array);

    // SAFETY: `T` has no uninitialized padding (audited via the per-type layout
    // asserts in padding_checker.rs); reading its bytes is sound.
    let bytes: &[u8] =
        unsafe { bun_core::ffi::slice(array.as_ptr().cast::<u8>(), core::mem::size_of_val(array)) };

    let start_pos = stream.get_pos()?;
    stream.write_int_le::<u64>(0xDEAD_BEEF)?;
    stream.write_int_le::<u64>(0xDEAD_BEEF)?;

    // The reader skips this prefix by absolute offset so it is semantically
    // inert, but we emit the exact historical bytes so that re-saving an
    // unchanged lockfile is a byte no-op. Call sites pass the verbatim
    // type-name string (including its sizeof/alignof suffix) as a literal.
    stream.write_all(prefix.as_bytes())?;

    if !bytes.is_empty() {
        let pos = stream.get_pos()? as u64;
        let _ = Aligner::write_with_align(sizes::ALIGN_TYPE_0, &mut *stream, pos)?;

        let real_start_pos = stream.get_pos()? as u64;
        stream.write_all(bytes)?;
        let real_end_pos = stream.get_pos()? as u64;
        let positioned: [u64; 2] = [real_start_pos, real_end_pos];
        // `[u64; 2]` and `[u8; 16]` are both `Pod` of equal size — `bytemuck`
        // gives the byte view without `unsafe`.
        let positioned_bytes: &[u8; 16] = bytemuck::cast_ref(&positioned);
        let mut written: usize = 0;
        while written < 16 {
            written += stream.pwrite(&positioned_bytes[written..], start_pos + written);
        }
    } else {
        let real_end_pos = stream.get_pos()? as u64;
        let positioned: [u64; 2] = [real_end_pos, real_end_pos];
        // `[u64; 2]` and `[u8; 16]` are both `Pod` of equal size — `bytemuck`
        // gives the byte view without `unsafe`.
        let positioned_bytes: &[u8; 16] = bytemuck::cast_ref(&positioned);
        let mut written: usize = 0;
        while written < 16 {
            written += stream.pwrite(&positioned_bytes[written..], start_pos + written);
        }
    }
    Ok(())
}

pub(crate) fn save<S>(
    lockfile: &Lockfile,
    options: &PackageManagerOptions,
    stream: &mut S,
) -> crate::Result<()>
where
    // See `write_array` — a single bound avoids two `&mut` to the same object.
    S: lockfile::PositionalStream + bun_io::Write,
{
    let buffers = &lockfile.buffers;

    // The fields are saved unrolled in declaration order (see `sizes` module
    // note).

    macro_rules! save_generic_field {
        ($field:ident, $name:literal, $elem:ty, $prefix:literal) => {{
            if options.log_level.is_verbose() {
                bun_core::pretty_errorln!("Saving {} {}", buffers.$field.len(), $name);
            }
            // We duplicate it here so that alignment bytes are zeroed out
            let mut clone: Vec<$elem> = Vec::with_capacity(buffers.$field.len());
            clone.extend_from_slice(buffers.$field.as_slice());
            write_array(stream, clone.as_slice(), $prefix)?;
        }};
    }

    // -- trees --
    {
        if options.log_level.is_verbose() {
            bun_core::pretty_errorln!("Saving {} {}", buffers.trees.len(), "trees");
        }
        // Write the explicit `Tree.External` form so the on-disk layout is
        // independent of `repr(Rust)` field order: 20 bytes/tree, fields in
        // the `[id|dep_id|parent|off|len]` order that `load` decodes via
        // `Tree.toTree`.
        let mut clone: Vec<tree::External> = Vec::with_capacity(buffers.trees.len());
        for &item in buffers.trees.as_slice() {
            clone.push(Tree::to_external(item));
        }
        write_array(
            stream,
            clone.as_slice(),
            // Verbatim historical type-name string. It reports `4 alignof` even
            // though we serialize `tree::External` (`[u8;20]`, align 1). The
            // reader ignores this string; only the exact bytes matter.
            "\n<install.lockfile.Tree> 20 sizeof, 4 alignof\n",
        )?;
    }

    // -- hoisted_dependencies --
    save_generic_field!(
        hoisted_dependencies,
        "hoisted_dependencies",
        DependencyID,
        "\n<u32> 4 sizeof, 4 alignof\n"
    );

    // -- resolutions --
    save_generic_field!(
        resolutions,
        "resolutions",
        PackageID,
        "\n<u32> 4 sizeof, 4 alignof\n"
    );

    // -- dependencies --
    {
        if options.log_level.is_verbose() {
            bun_core::pretty_errorln!("Saving {} {}", buffers.dependencies.len(), "dependencies");
        }

        // Dependencies have to be converted to .toExternal first
        // We store pointers in Version.Value, so we can't just write it directly
        let remaining = buffers.dependencies.as_slice();

        #[cfg(debug_assertions)]
        {
            use bun_install::dependency::version::Tag;
            const SEP_WINDOWS: u8 = b'\\';
            for dep in remaining {
                // SAFETY: `dep.version.value` is a tag-discriminated union; each
                // arm reads only the field corresponding to `dep.version.tag`.
                match dep.version.tag {
                    Tag::Folder => {
                        let folder = lockfile.str(dep.version.folder());
                        if strings::contains_char(folder, SEP_WINDOWS) {
                            panic!("workspace windows separator: {}\n", bstr::BStr::new(folder));
                        }
                    }
                    Tag::Tarball => {
                        if let crate::dependency::URI::Local(local) = dep.version.tarball().uri {
                            let tarball = lockfile.str(&local);
                            if strings::contains_char(tarball, SEP_WINDOWS) {
                                panic!("tarball windows separator: {}", bstr::BStr::new(tarball));
                            }
                        }
                    }
                    Tag::Workspace => {
                        let workspace = lockfile.str(dep.version.workspace());
                        if strings::contains_char(workspace, SEP_WINDOWS) {
                            panic!(
                                "workspace windows separator: {}\n",
                                bstr::BStr::new(workspace)
                            );
                        }
                    }
                    Tag::Symlink => {
                        let symlink = lockfile.str(dep.version.symlink());
                        if strings::contains_char(symlink, SEP_WINDOWS) {
                            panic!("symlink windows separator: {}\n", bstr::BStr::new(symlink));
                        }
                    }
                    _ => {}
                }
            }
        }

        // It would be faster to buffer these instead of one big allocation
        let mut to_clone: Vec<dependency::External> = Vec::with_capacity(remaining.len());
        for dep in remaining {
            to_clone.push(dependency::to_external(dep));
        }

        write_array(
            stream,
            to_clone.as_slice(),
            "\n<[26]u8> 26 sizeof, 1 alignof\n",
        )?;
    }

    // -- extern_strings --
    save_generic_field!(
        extern_strings,
        "extern_strings",
        bun_semver::ExternalString,
        "\n<semver.ExternalString.ExternalString> 16 sizeof, 8 alignof\n"
    );

    // -- string_bytes --
    save_generic_field!(
        string_bytes,
        "string_bytes",
        u8,
        "\n<u8> 1 sizeof, 1 alignof\n"
    );

    Ok(())
}

impl Buffers {
    pub(crate) fn legacy_package_to_dependency_id(
        &self,
        package_id: PackageID,
    ) -> crate::Result<DependencyID> {
        match package_id {
            0 => Ok(tree::ROOT_DEP_ID),
            id if id == invalid_package_id => Ok(invalid_package_id),
            _ => (self.resolutions.iter())
                .position(|&pkg_id| pkg_id == package_id)
                .map(|dep_id| dep_id as DependencyID)
                .ok_or(crate::Error::LockfileIsMissingResolutionData),
        }
    }
}

pub(crate) fn load(
    stream: &mut Stream,
    log: &mut bun_ast::Log,
    pm_: Option<&PackageManager>,
    packages_len: usize,
) -> crate::Result<Buffers> {
    let mut this = Buffers::default();
    let external_dependency_list_: Vec<dependency::External>;

    // The fields are loaded unrolled in declaration order (see `sizes` module
    // note).

    macro_rules! load_generic_field {
        ($field:ident, $name:literal, $elem:ty) => {{
            this.$field = read_array::<$elem>(stream)?;
            if let Some(pm) = pm_ {
                if pm.options.log_level.is_verbose() {
                    bun_core::pretty_errorln!("Loaded {} {}", this.$field.len(), $name);
                }
            }
        }};
    }

    // -- trees --
    {
        let tree_list: Vec<tree::External> = read_array(stream)?;
        // `set_len` then `iter_mut()` would form `&mut Tree` to uninitialized
        // memory (UB), so we push into the reserved capacity instead.
        this.trees = tree::List::with_capacity(tree_list.len());
        for from in &tree_list {
            this.trees.push(Tree::to_tree(*from));
        }
        debug_assert_eq!(tree_list.len(), this.trees.len());
    }

    // -- hoisted_dependencies --
    load_generic_field!(hoisted_dependencies, "hoisted_dependencies", DependencyID);

    // -- resolutions --
    load_generic_field!(resolutions, "resolutions", PackageID);

    // -- dependencies --
    {
        external_dependency_list_ = read_array::<dependency::External>(stream)?;
        if let Some(pm) = pm_ {
            if pm.options.log_level.is_verbose() {
                bun_core::pretty_errorln!(
                    "Loaded {} {}",
                    external_dependency_list_.len(),
                    "dependencies"
                );
            }
        }
    }

    // -- extern_strings --
    load_generic_field!(extern_strings, "extern_strings", bun_semver::ExternalString);

    // -- string_bytes --
    load_generic_field!(string_bytes, "string_bytes", u8);

    let external_dependency_list = external_dependency_list_.as_slice();
    // Dependencies are serialized separately.
    // This is unfortunate. However, not using pointers for Semver Range's make the code a lot more complex.
    this.dependencies = DependencyList::with_capacity(external_dependency_list.len());
    let string_buf = this.string_bytes.as_slice();
    let mut extern_context = dependency::Context {
        log,
        // allocator dropped — global mimalloc
        buffer: string_buf,
    };
    // `set_len` then `as_mut_slice()` would form `&mut Dependency` to
    // uninitialized memory (UB even when write-only), so we push into the
    // reserved capacity instead.
    for ext in external_dependency_list {
        this.dependencies
            .push(dependency::to_dependency(*ext, &mut extern_context));
    }
    debug_assert!(external_dependency_list.len() == this.dependencies.len());

    // Legacy tree structure stores package IDs instead of dependency IDs
    if !this.trees.is_empty() && this.trees[0].dependency_id != tree::ROOT_DEP_ID {
        // Each mention of a package is the next dependency that resolves to it: `first[package]`, `next[dependency]`.
        let mut first: Vec<DependencyID> = vec![invalid_package_id; packages_len];
        let mut next: Vec<DependencyID> = vec![invalid_package_id; this.resolutions.len()];
        for (dependency_id, &package_id) in this.resolutions.iter().enumerate().rev() {
            if let Some(head) = first.get_mut(package_id as usize) {
                next[dependency_id] = *head;
                *head = dependency_id as DependencyID;
            }
        }
        let take = |heads: &mut [DependencyID], id: &mut u32| -> crate::Result<()> {
            if *id == 0 {
                *id = tree::ROOT_DEP_ID;
            } else if *id != invalid_package_id {
                let head = (heads.get_mut(*id as usize))
                    .filter(|head| **head != invalid_package_id)
                    .ok_or(crate::Error::LockfileIsMissingResolutionData)?;
                *id = *head;
                *head = next[*id as usize];
            }
            Ok(())
        };
        let mut heads = first.clone();
        for tree in &mut this.trees {
            take(&mut heads, &mut tree.dependency_id)?;
        }
        for id in &mut this.hoisted_dependencies {
            take(&mut first, id)?;
        }

        // Those writers (before v0.5.7) also left unused slots in the list and gave the root no id.
        let mut kept: tree::Id = 0;
        let new_ids: Vec<tree::Id> = (this.trees.iter())
            .map(|tree| {
                let id = kept;
                kept += tree::Id::from(tree.id != tree::INVALID_ID);
                id
            })
            .collect();
        this.trees.retain(|tree| tree.id != tree::INVALID_ID);
        for tree in &mut this.trees {
            for id in [&mut tree.id, &mut tree.parent] {
                if *id != tree::INVALID_ID {
                    *id = *(new_ids.get(*id as usize)).ok_or(crate::Error::InvalidLockfile)?;
                }
            }
        }
        if let Some(root) = this.trees.first_mut() {
            root.dependency_id = tree::ROOT_DEP_ID;
        }
    }

    Ok(this)
}
