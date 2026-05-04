use core::mem::{align_of, size_of};

use bun_collections::DynamicBitSet as Bitset;
use bun_core::Output;
use bun_logger as logger;
use bun_str::strings;

use bun_install::lockfile::{
    self as lockfile, assert_no_uninitialized_padding, DependencyIDList, DependencyList,
    ExternalStringBuffer, Lockfile, PackageIDList, Stream, StringBuffer, Tree,
};
use bun_install::{
    invalid_package_id, Aligner, Dependency, DependencyID, PackageID, PackageManager,
};

#[derive(Default)]
pub struct Buffers {
    pub trees: Tree::List,
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

// PORT NOTE: Zig `deinit` only freed owned ArrayListUnmanaged fields; in Rust the
// Vec-backed field types drop automatically, so no explicit `Drop` impl is needed.

impl Buffers {
    pub fn preallocate(&mut self, that: &Buffers) -> Result<(), bun_alloc::AllocError> {
        // TODO(port): narrow error set
        self.trees
            .reserve(that.trees.len().saturating_sub(self.trees.len()));
        self.resolutions
            .reserve(that.resolutions.len().saturating_sub(self.resolutions.len()));
        self.dependencies
            .reserve(that.dependencies.len().saturating_sub(self.dependencies.len()));
        self.extern_strings
            .reserve(that.extern_strings.len().saturating_sub(self.extern_strings.len()));
        self.string_bytes
            .reserve(that.string_bytes.len().saturating_sub(self.string_bytes.len()));
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `sizes` — comptime field-order table
//
// PORT NOTE: the Zig computed this with `std.meta.fields` + an insertion sort
// by descending `@alignOf(field.type)`. Every field is an `ArrayListUnmanaged`,
// whose alignment is `@alignOf(usize)`, so the stable sort is a no-op and the
// result is declaration order. We hard-code that order here. `types[0]` (used
// only for `Aligner.write`) was `Tree.List.Slice` i.e. `[]Tree`; we keep its
// element alignment as `ALIGN_TYPE_0`.
// ──────────────────────────────────────────────────────────────────────────
mod sizes {
    use super::*;

    pub const NAMES: [&str; 6] = [
        "trees",
        "hoisted_dependencies",
        "resolutions",
        "dependencies",
        "extern_strings",
        "string_bytes",
    ];

    /// Alignment used by `Aligner::write` for every array payload (Zig: `sizes.types[0]`).
    pub const ALIGN_TYPE_0: usize = align_of::<Tree>();

    // `sizes.bytes` was never read in the Zig; omitted.
    // TODO(port): if another file reads `Buffers.sizes.bytes`, add it back.
}

pub fn read_array<T: Copy>(stream: &mut Stream) -> Result<Vec<T>, bun_core::Error> {
    // TODO(port): narrow error set (CorruptLockfile | OOM)
    let mut reader = stream.reader();
    let start_pos = reader.read_int_le::<u64>()?;

    // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
    if start_pos == 0xDEAD_BEEF {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    // These are absolute numbers, it shouldn't be zero.
    // There's a prefix before any of the arrays, so it can never be zero here.
    if start_pos == 0 {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    // We shouldn't be going backwards.
    if start_pos < (stream.pos as u64).saturating_sub(size_of::<u64>() as u64) {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    let end_pos = reader.read_int_le::<u64>()?;

    // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
    // That shouldn't happen.
    if end_pos == 0xDEAD_BEEF {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    // These are absolute numbers, it shouldn't be zero.
    if end_pos == 0 {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    // Prevent integer overflow.
    if start_pos > end_pos {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    // Prevent buffer overflow.
    if end_pos > stream.buffer.len() as u64 {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    let byte_len = end_pos - start_pos;
    stream.pos = end_pos as usize;

    if byte_len == 0 {
        return Ok(Vec::new());
    }

    let start_pos = start_pos as usize;
    let end_pos = end_pos as usize;
    // SAFETY: `start_pos..end_pos` is in-bounds (checked above) and the lockfile
    // writer aligned the payload to `align_of::<T>()` via `Aligner::write`. Zig
    // used `@alignCast` here with the same precondition.
    let misaligned: &[T] = unsafe {
        core::slice::from_raw_parts(
            stream.buffer.as_ptr().add(start_pos).cast::<T>(),
            (end_pos - start_pos) / size_of::<T>(),
        )
    };

    Ok(misaligned.to_vec())
}

pub fn write_array<S, W, T>(
    stream: &mut S,
    writer: &mut W,
    array: &[T],
    type_name: &'static str,
    size: usize,
    align: usize,
) -> Result<(), bun_core::Error>
where
    S: lockfile::PositionalStream,
    W: bun_io::Write,
    // TODO(port): narrow error set
{
    // TODO(port): comptime `assertNoUninitializedPadding(@TypeOf(array))` — needs
    // a const-eval padding check on `T`; Phase B can add a `const _: () = assert!(...)`
    // per call site or a `NoPadding` marker trait.
    let _ = assert_no_uninitialized_padding::<T>;
    debug_assert_eq!(size, size_of::<T>());
    debug_assert_eq!(align, align_of::<T>());

    // SAFETY: `T` has no uninitialized padding (asserted above in Zig); reading
    // its bytes is sound. Matches `std.mem.sliceAsBytes`.
    let bytes: &[u8] = unsafe {
        core::slice::from_raw_parts(array.as_ptr().cast::<u8>(), core::mem::size_of_val(array))
    };

    let start_pos = stream.get_pos()?;
    writer.write_int_le::<u64>(0xDEAD_BEEF)?;
    writer.write_int_le::<u64>(0xDEAD_BEEF)?;

    // PORT NOTE: Zig built this with `std.fmt.comptimePrint` over
    // `@typeName/@sizeOf/@alignOf(std.meta.Child(ArrayList))`. `@typeName` has no
    // stable Rust equivalent, so each monomorphized call site passes
    // `type_name`/`size`/`align` explicitly and we format at runtime — the reader
    // skips this prefix by absolute offset, so only per-`T` determinism matters.
    // TODO(port): verify prefix string byte-for-byte matches Zig `@typeName` output
    // for migration compat (call sites currently pass Rust-spelled names).
    let prefix = format!("\n<{}> {} sizeof, {} alignof\n", type_name, size, align);
    // PERF(port): was `comptimePrint` (zero-cost &'static str) — profile in Phase B
    writer.write_all(prefix.as_bytes())?;

    if !bytes.is_empty() {
        let _ = Aligner::write_with_align(sizes::ALIGN_TYPE_0, writer, stream.get_pos()?)?;

        let real_start_pos = stream.get_pos()? as u64;
        writer.write_all(bytes)?;
        let real_end_pos = stream.get_pos()? as u64;
        let positioned: [u64; 2] = [real_start_pos, real_end_pos];
        // SAFETY: `[u64; 2]` is POD; viewing as 16 bytes matches `std.mem.asBytes`.
        let positioned_bytes: &[u8; 16] =
            unsafe { &*(&positioned as *const [u64; 2] as *const [u8; 16]) };
        let mut written: usize = 0;
        while written < 16 {
            written += stream.pwrite(&positioned_bytes[written..], start_pos + written);
        }
    } else {
        let real_end_pos = stream.get_pos()? as u64;
        let positioned: [u64; 2] = [real_end_pos, real_end_pos];
        // SAFETY: `[u64; 2]` is POD; viewing as 16 bytes matches `std.mem.asBytes`.
        let positioned_bytes: &[u8; 16] =
            unsafe { &*(&positioned as *const [u64; 2] as *const [u8; 16]) };
        let mut written: usize = 0;
        while written < 16 {
            written += stream.pwrite(&positioned_bytes[written..], start_pos + written);
        }
    }
    Ok(())
}

pub fn save<S, W>(
    lockfile: &Lockfile,
    options: &PackageManager::Options,
    stream: &mut S,
    writer: &mut W,
) -> Result<(), bun_core::Error>
where
    S: lockfile::PositionalStream,
    W: bun_io::Write,
{
    let buffers = &lockfile.buffers;

    // PORT NOTE: Zig used `inline for (sizes.names) |name|` + `@field(buffers, name)`.
    // Rust has no field-name reflection, so the loop is unrolled in declaration
    // order (see `sizes` module note — the comptime sort was a no-op).

    macro_rules! save_generic_field {
        ($field:ident, $name:literal, $elem:ty) => {{
            if options.log_level.is_verbose() {
                Output::pretty_errorln(format_args!(
                    "Saving {} {}",
                    buffers.$field.len(),
                    $name
                ));
            }
            // PORT NOTE: the Zig had `if (comptime Type == Tree)` here, but `Type`
            // was `@TypeOf(list.items)` i.e. `[]Elem`, never `Tree`, so that arm
            // was dead. We port only the live `else` arm.
            // We duplicate it here so that alignment bytes are zeroed out
            let mut clone: Vec<$elem> = Vec::with_capacity(buffers.$field.len());
            clone.extend_from_slice(buffers.$field.as_slice());
            // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
            write_array(
                stream,
                writer,
                clone.as_slice(),
                // TODO(port): @typeName parity — Zig emits fully-qualified name
                stringify!($elem),
                size_of::<$elem>(),
                align_of::<$elem>(),
            )?;
            #[cfg(debug_assertions)]
            {
                // Output::pretty_errorln(format_args!("Field {}: {} - {}", $name, pos, stream.get_pos()?));
            }
        }};
    }

    // -- trees --
    save_generic_field!(trees, "trees", Tree);

    // -- hoisted_dependencies --
    save_generic_field!(hoisted_dependencies, "hoisted_dependencies", DependencyID);

    // -- resolutions --
    save_generic_field!(resolutions, "resolutions", PackageID);

    // -- dependencies --
    {
        if options.log_level.is_verbose() {
            Output::pretty_errorln(format_args!(
                "Saving {} {}",
                buffers.dependencies.len(),
                "dependencies"
            ));
        }

        // Dependencies have to be converted to .toExternal first
        // We store pointers in Version.Value, so we can't just write it directly
        let remaining = buffers.dependencies.as_slice();

        #[cfg(debug_assertions)]
        {
            use bun_install::dependency::version::Tag;
            const SEP_WINDOWS: u8 = b'\\';
            for dep in remaining {
                match dep.version.tag {
                    Tag::Folder => {
                        let folder = lockfile.str(&dep.version.value.folder);
                        if strings::index_of_char(folder, SEP_WINDOWS).is_some() {
                            panic!(
                                "workspace windows separator: {}\n",
                                bstr::BStr::new(folder)
                            );
                        }
                    }
                    Tag::Tarball => {
                        if let bun_install::dependency::TarballUri::Local(local) =
                            &dep.version.value.tarball.uri
                        {
                            let tarball = lockfile.str(local);
                            if strings::index_of_char(tarball, SEP_WINDOWS).is_some() {
                                panic!(
                                    "tarball windows separator: {}",
                                    bstr::BStr::new(tarball)
                                );
                            }
                        }
                    }
                    Tag::Workspace => {
                        let workspace = lockfile.str(&dep.version.value.workspace);
                        if strings::index_of_char(workspace, SEP_WINDOWS).is_some() {
                            panic!(
                                "workspace windows separator: {}\n",
                                bstr::BStr::new(workspace)
                            );
                        }
                    }
                    Tag::Symlink => {
                        let symlink = lockfile.str(&dep.version.value.symlink);
                        if strings::index_of_char(symlink, SEP_WINDOWS).is_some() {
                            panic!(
                                "symlink windows separator: {}\n",
                                bstr::BStr::new(symlink)
                            );
                        }
                    }
                    _ => {}
                }
            }
        }

        // It would be faster to buffer these instead of one big allocation
        let mut to_clone: Vec<Dependency::External> = Vec::with_capacity(remaining.len());
        for dep in remaining {
            to_clone.push(Dependency::to_external(*dep));
            // PERF(port): was appendAssumeCapacity — profile in Phase B
        }

        write_array(
            stream,
            writer,
            to_clone.as_slice(),
            // TODO(port): @typeName parity — Zig emits fully-qualified name
            "Dependency.External",
            size_of::<Dependency::External>(),
            align_of::<Dependency::External>(),
        )?;

        #[cfg(debug_assertions)]
        {
            // Output::pretty_errorln(format_args!("Field {}: {} - {}", "dependencies", pos, stream.get_pos()?));
        }
    }

    // -- extern_strings --
    save_generic_field!(
        extern_strings,
        "extern_strings",
        bun_semver::ExternalString
    );

    // -- string_bytes --
    save_generic_field!(string_bytes, "string_bytes", u8);

    Ok(())
}

impl Buffers {
    pub fn legacy_package_to_dependency_id(
        &self,
        dependency_visited: Option<&mut Bitset>,
        package_id: PackageID,
    ) -> Result<DependencyID, bun_core::Error> {
        match package_id {
            0 => return Ok(Tree::ROOT_DEP_ID),
            id if id == invalid_package_id => return Ok(invalid_package_id),
            _ => {
                // PORT NOTE: reshaped for borrowck — `dependency_visited` is
                // captured once outside the loop instead of re-matched per iter.
                let mut visited = dependency_visited;
                for (dep_id, &pkg_id) in self.resolutions.iter().enumerate() {
                    if pkg_id == package_id {
                        if let Some(visited) = visited.as_deref_mut() {
                            if visited.is_set(dep_id) {
                                continue;
                            }
                            visited.set(dep_id);
                        }
                        return Ok(dep_id as DependencyID);
                    }
                }
            }
        }
        Err(bun_core::err!("Lockfile is missing resolution data"))
    }
}

pub fn load(
    stream: &mut Stream,
    log: &mut logger::Log,
    pm_: Option<&mut PackageManager>,
) -> Result<Buffers, bun_core::Error> {
    let mut this = Buffers::default();
    let mut external_dependency_list_: Vec<Dependency::External> = Vec::new();

    // PORT NOTE: Zig `inline for (sizes.names)` unrolled — see `sizes` module note.

    macro_rules! load_generic_field {
        ($field:ident, $name:literal, $elem:ty) => {{
            #[cfg(debug_assertions)]
            let _pos: usize = stream.get_pos().unwrap_or(0);

            this.$field = read_array::<$elem>(stream)?;
            if let Some(pm) = pm_.as_deref() {
                if pm.options.log_level.is_verbose() {
                    Output::pretty_errorln(format_args!(
                        "Loaded {} {}",
                        this.$field.len(),
                        $name
                    ));
                }
            }
            // #[cfg(debug_assertions)]
            // Output::pretty_errorln(format_args!("Field {}: {} - {}", $name, _pos, stream.get_pos()?));
        }};
    }

    // -- trees --
    {
        #[cfg(debug_assertions)]
        let _pos: usize = stream.get_pos().unwrap_or(0);

        let tree_list: Vec<Tree::External> = read_array(stream)?;
        this.trees = Tree::List::with_capacity(tree_list.len());
        // SAFETY: capacity == tree_list.len() reserved above; every slot is
        // written in the loop below before any read. Matches Zig
        // `this.trees.items.len = tree_list.items.len;`.
        unsafe { this.trees.set_len(tree_list.len()) };
        debug_assert_eq!(tree_list.len(), this.trees.len());
        for (from, to) in tree_list.iter().zip(this.trees.iter_mut()) {
            *to = Tree::to_tree(*from);
        }
    }

    // -- hoisted_dependencies --
    load_generic_field!(hoisted_dependencies, "hoisted_dependencies", DependencyID);

    // -- resolutions --
    load_generic_field!(resolutions, "resolutions", PackageID);

    // -- dependencies --
    {
        #[cfg(debug_assertions)]
        let _pos: usize = stream.get_pos().unwrap_or(0);

        external_dependency_list_ = read_array::<Dependency::External>(stream)?;
        if let Some(pm) = pm_.as_deref() {
            if pm.options.log_level.is_verbose() {
                Output::pretty_errorln(format_args!(
                    "Loaded {} {}",
                    external_dependency_list_.len(),
                    "dependencies"
                ));
            }
        }
    }

    // -- extern_strings --
    load_generic_field!(
        extern_strings,
        "extern_strings",
        bun_semver::ExternalString
    );

    // -- string_bytes --
    load_generic_field!(string_bytes, "string_bytes", u8);

    let external_dependency_list = external_dependency_list_.as_slice();
    // Dependencies are serialized separately.
    // This is unfortunate. However, not using pointers for Semver Range's make the code a lot more complex.
    this.dependencies = DependencyList::with_capacity(external_dependency_list.len());
    let string_buf = this.string_bytes.as_slice();
    let extern_context = Dependency::Context {
        log,
        // allocator: dropped — global mimalloc
        buffer: string_buf,
        package_manager: pm_,
    };
    // TODO(port): `Dependency::Context` borrows `log`, `string_buf`, and `pm_`
    // simultaneously with `&mut this`; Phase B may need to restructure borrows.

    // expandToCapacity + items.len = N
    // SAFETY: capacity reserved above; every slot is written in the loop below.
    unsafe { this.dependencies.set_len(external_dependency_list.len()) };

    {
        let mut external_deps = external_dependency_list.as_ptr();
        let dependencies = this.dependencies.as_mut_slice();
        debug_assert!(external_dependency_list.len() == dependencies.len());
        for dep in dependencies {
            // SAFETY: `external_deps` walks exactly `external_dependency_list.len()`
            // elements, equal to `dependencies.len()` (asserted above).
            *dep = Dependency::to_dependency(unsafe { *external_deps }, &extern_context);
            unsafe { external_deps = external_deps.add(1) };
        }
    }

    // Legacy tree structure stores package IDs instead of dependency IDs
    if !this.trees.is_empty() && this.trees[0].dependency_id != Tree::ROOT_DEP_ID {
        let mut visited = Bitset::init_empty(this.dependencies.len())?;
        // PORT NOTE: reshaped for borrowck — iterate by index so
        // `legacy_package_to_dependency_id` can borrow `&self` while we hold
        // `&mut this.trees[i]`.
        for i in 0..this.trees.len() {
            let package_id = this.trees[i].dependency_id;
            this.trees[i].dependency_id =
                this.legacy_package_to_dependency_id(Some(&mut visited), package_id)?;
        }
        visited.set_range_value(0..this.dependencies.len(), false);
        for i in 0..this.hoisted_dependencies.len() {
            let pid = this.hoisted_dependencies[i];
            this.hoisted_dependencies[i] =
                this.legacy_package_to_dependency_id(Some(&mut visited), pid)?;
        }
        // `visited` drops here.
    }

    Ok(this)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/Buffers.zig (406 lines)
//   confidence: medium
//   todos:      9
//   notes:      `sizes` comptime reflection hand-unrolled (sort was no-op); `write_array` prefix built at runtime from caller-supplied type_name/size/align (formatcp! can't take generic-T args) — still needs @typeName byte parity for on-disk compat; several borrowck reshapes in load().
// ──────────────────────────────────────────────────────────────────────────
