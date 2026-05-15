use core::mem::size_of;

use bun_collections::DynamicBitSet as Bitset;
use bun_core::Output;
use bun_core::strings;

// PORT NOTE: `use super::{self as lockfile, ...}` and bare `use super as lockfile;`
// are both rejected by rustc (E0432: "no `super` in the root" — rust-lang/rust#48067),
// so the parent-module alias is spelled via its crate path instead.
use super::{
    DependencyIDList, DependencyList, ExternalStringBuffer, Lockfile, PackageIDList, Stream,
    StringBuffer, Tree, assert_no_uninitialized_padding, tree,
};
use crate::lockfile_real as lockfile;
use crate::package_manager_real::package_manager_options::Options as PackageManagerOptions;
use crate::{
    Aligner, Dependency, DependencyID, PackageID, PackageManager, dependency, invalid_package_id,
};

#[derive(Default)]
pub struct Buffers {
    pub trees: tree::List,
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
// `sizes` — comptime field-order table
//
// PORT NOTE: the Zig computed this with `std.meta.fields` + an insertion sort
// by descending `@alignOf(field.type)`. Every field is an `ArrayListUnmanaged`,
// whose alignment is `@alignOf(usize)`, so the stable sort is a no-op and the
// result is declaration order. We hard-code that order here. `types[0]` (used
// only for `Aligner.write`) was `Tree.List.Slice` i.e. `[]Tree`; Zig's
// `@alignOf([]Tree)` is the alignment of the SLICE fat-pointer (ptr+len), i.e.
// `@alignOf(usize)`, NOT the element alignment — so we keep that as
// `ALIGN_TYPE_0`.
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
    ///
    /// `sizes.types[0]` in Zig is `[]Tree` (a slice type), and `@alignOf([]Tree)` is the
    /// alignment of the slice descriptor (a `(*T, usize)` fat pointer) — i.e. `@alignOf(usize)`,
    /// not `@alignOf(Tree)`. This 8-byte boundary is load-bearing for on-disk parity AND for
    /// `read_array::<ExternalString>` (which has a `u64` field) to produce an aligned `&[T]`.
    pub const ALIGN_TYPE_0: usize = align_of::<usize>();
    const _: () = assert!(ALIGN_TYPE_0 == align_of::<&[Tree]>());

    // `sizes.bytes` was never read in the Zig; omitted.
    // TODO(port): if another file reads `Buffers.sizes.bytes`, add it back.
}

pub fn read_array<T: Copy>(stream: &mut Stream) -> Result<Vec<T>, bun_core::Error> {
    // TODO(port): narrow error set (CorruptLockfile | OOM)
    // PORT NOTE: Zig went through `stream.reader()`; `FixedBufferStream` exposes
    // `read_int_le` directly, so the intermediate reader handle is elided.
    let start_pos = stream.read_int_le::<u64>()?;

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

    let end_pos = stream.read_int_le::<u64>()?;

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
        // Empty arrays are written by `write_array`'s else-branch without an
        // `Aligner::write_with_align` pad, so their recorded start offset need not
        // be aligned. Match Zig's `readArray`, which returns the empty slice
        // before any alignment checks.
        return Ok(Vec::new());
    }

    if start_pos % core::mem::align_of::<T>() as u64 != 0 || byte_len % size_of::<T>() as u64 != 0 {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    let start_pos = start_pos as usize;
    let end_pos = end_pos as usize;
    // SAFETY: `start_pos..end_pos` is in-bounds (checked above) and the lockfile
    // writer aligned the payload to `align_of::<T>()` via `Aligner::write`. Zig
    // used `@alignCast` here with the same precondition.
    let misaligned: &[T] = unsafe {
        bun_core::ffi::slice(
            stream.buffer.as_ptr().add(start_pos).cast::<T>(),
            (end_pos - start_pos) / size_of::<T>(),
        )
    };

    Ok(misaligned.to_vec())
}

pub fn write_array<S, T>(
    stream: &mut S,
    array: &[T],
    prefix: &'static str,
) -> Result<(), bun_core::Error>
where
    // PORT NOTE: Zig threaded a separate `stream` (anytype) and `writer` over the
    // same buffer. Two `&mut` to one object is UB in Rust regardless of access
    // order, so the port collapses both roles onto one type — `StreamType` impls
    // both `PositionalStream` (get_pos/pwrite) and `bun_io::Write` (append).
    S: lockfile::PositionalStream + bun_io::Write,
    // TODO(port): narrow error set
{
    // TODO(port): comptime `assertNoUninitializedPadding(@TypeOf(array))` — needs
    // a const-eval padding check on `T`; Phase B can add a `const _: () = assert!(...)`
    // per call site or a `NoPadding` marker trait.
    assert_no_uninitialized_padding(array);

    // SAFETY: `T` has no uninitialized padding (asserted above in Zig); reading
    // its bytes is sound. Matches `std.mem.sliceAsBytes`.
    let bytes: &[u8] =
        unsafe { bun_core::ffi::slice(array.as_ptr().cast::<u8>(), core::mem::size_of_val(array)) };

    let start_pos = stream.get_pos()?;
    stream.write_int_le::<u64>(0xDEAD_BEEF)?;
    stream.write_int_le::<u64>(0xDEAD_BEEF)?;

    // PORT NOTE: Zig built this with `std.fmt.comptimePrint` over
    // `@typeName/@sizeOf/@alignOf(std.meta.Child(ArrayList))`. The reader skips
    // this prefix by absolute offset so it is semantically inert, but we emit the
    // exact bytes Zig produces so that re-saving an unchanged lockfile is a byte
    // no-op across the Zig→Rust migration. Call sites pass the verbatim Zig
    // `@typeName` string (including its sizeof/alignof suffix) as a literal.
    stream.write_all(prefix.as_bytes())?;

    if !bytes.is_empty() {
        let pos = stream.get_pos()? as u64;
        let _ = Aligner::write_with_align(sizes::ALIGN_TYPE_0, &mut *stream, pos)?;

        let real_start_pos = stream.get_pos()? as u64;
        stream.write_all(bytes)?;
        let real_end_pos = stream.get_pos()? as u64;
        let positioned: [u64; 2] = [real_start_pos, real_end_pos];
        // `[u64; 2]` and `[u8; 16]` are both `Pod` of equal size — `bytemuck`
        // gives the same `std.mem.asBytes` view without `unsafe`.
        let positioned_bytes: &[u8; 16] = bytemuck::cast_ref(&positioned);
        let mut written: usize = 0;
        while written < 16 {
            written += stream.pwrite(&positioned_bytes[written..], start_pos + written);
        }
    } else {
        let real_end_pos = stream.get_pos()? as u64;
        let positioned: [u64; 2] = [real_end_pos, real_end_pos];
        // `[u64; 2]` and `[u8; 16]` are both `Pod` of equal size — `bytemuck`
        // gives the same `std.mem.asBytes` view without `unsafe`.
        let positioned_bytes: &[u8; 16] = bytemuck::cast_ref(&positioned);
        let mut written: usize = 0;
        while written < 16 {
            written += stream.pwrite(&positioned_bytes[written..], start_pos + written);
        }
    }
    Ok(())
}

pub fn save<S>(
    lockfile: &Lockfile,
    options: &PackageManagerOptions,
    stream: &mut S,
) -> Result<(), bun_core::Error>
where
    // PORT NOTE: see `write_array` — Zig's separate stream/writer aliased one
    // buffer; collapsed to a single bound to avoid two `&mut` to the same object.
    S: lockfile::PositionalStream + bun_io::Write,
{
    let buffers = &lockfile.buffers;

    // PORT NOTE: Zig used `inline for (sizes.names) |name|` + `@field(buffers, name)`.
    // Rust has no field-name reflection, so the loop is unrolled in declaration
    // order (see `sizes` module note — the comptime sort was a no-op).

    macro_rules! save_generic_field {
        ($field:ident, $name:literal, $elem:ty, $prefix:literal) => {{
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
            write_array(stream, clone.as_slice(), $prefix)?;
            #[cfg(debug_assertions)]
            {
                // Output::pretty_errorln(format_args!("Field {}: {} - {}", $name, pos, stream.get_pos()?));
            }
        }};
    }

    // -- trees --
    {
        if options.log_level.is_verbose() {
            Output::pretty_errorln(format_args!("Saving {} {}", buffers.trees.len(), "trees"));
        }
        // PORT NOTE: Zig's `if (comptime Type == Tree)` arm (Buffers.zig:248)
        // never fires because `Type` is `[]Tree`, so Zig writes raw `Tree`
        // bytes — which works only because Zig's auto-layout for `Tree` happens
        // to match the `[id|dep_id|parent|off|len]` encoding that `load`
        // decodes via `Tree.toTree`. We instead write the explicit
        // `Tree.External` form so the on-disk layout is independent of
        // `repr(Rust)` field order. This is byte-identical to what Zig emits
        // (both are 20 bytes/tree, same field order).
        let mut clone: Vec<tree::External> = Vec::with_capacity(buffers.trees.len());
        for &item in buffers.trees.as_slice() {
            clone.push(Tree::to_external(item));
        }
        write_array(
            stream,
            clone.as_slice(),
            // Verbatim Zig `@typeName(Tree)` output. Zig writes raw `Tree` (the
            // `Type == Tree` branch is dead — see PORT NOTE above), so it reports
            // `4 alignof` even though we serialize `tree::External` (`[u8;20]`,
            // align 1). The reader ignores this string; we match Zig's bytes.
            "\n<install.lockfile.Tree> 20 sizeof, 4 alignof\n",
        )?;
        #[cfg(debug_assertions)]
        {
            // Output::pretty_errorln(format_args!("Field {}: {} - {}", "trees", pos, stream.get_pos()?));
        }
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
            // PERF(port): was appendAssumeCapacity — profile in Phase B
        }

        write_array(
            stream,
            to_clone.as_slice(),
            // Zig: `@typeName(Dependency.External)` where `External = [26]u8`.
            "\n<[26]u8> 26 sizeof, 1 alignof\n",
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
    pub fn legacy_package_to_dependency_id(
        &self,
        dependency_visited: Option<&mut Bitset>,
        package_id: PackageID,
    ) -> Result<DependencyID, bun_core::Error> {
        match package_id {
            0 => return Ok(tree::ROOT_DEP_ID),
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
    log: &mut bun_ast::Log,
    pm_: Option<&mut PackageManager>,
) -> Result<Buffers, bun_core::Error> {
    let mut this = Buffers::default();
    let mut external_dependency_list_: Vec<dependency::External> = Vec::new();

    // PORT NOTE: Zig `inline for (sizes.names)` unrolled — see `sizes` module note.

    macro_rules! load_generic_field {
        ($field:ident, $name:literal, $elem:ty) => {{
            #[cfg(debug_assertions)]
            let _pos: usize = stream.pos;

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
        let _pos: usize = stream.pos;

        let tree_list: Vec<tree::External> = read_array(stream)?;
        // PORT NOTE: Zig did `initCapacity` + `items.len = N` + write each slot.
        // In Rust, `set_len` then `iter_mut()` would form `&mut Tree` to
        // uninitialized memory (UB), so we push into the reserved capacity
        // instead — same allocation pattern, no uninit reads.
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
        #[cfg(debug_assertions)]
        let _pos: usize = stream.pos;

        external_dependency_list_ = read_array::<dependency::External>(stream)?;
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
        package_manager: pm_,
    };
    // TODO(port): `Dependency::Context` borrows `log`, `string_buf`, and `pm_`
    // simultaneously with `&mut this`; Phase B may need to restructure borrows.

    // PORT NOTE: Zig did `expandToCapacity` + `items.len = N` then wrote each
    // slot via `*dep = ...`. In Rust, `set_len` then `as_mut_slice()` would form
    // `&mut Dependency` to uninitialized memory (UB even when write-only), so we
    // push into the reserved capacity instead — same single allocation, same
    // element order, no uninit references.
    for ext in external_dependency_list {
        this.dependencies
            .push(dependency::to_dependency(*ext, &mut extern_context));
    }
    debug_assert!(external_dependency_list.len() == this.dependencies.len());

    // Legacy tree structure stores package IDs instead of dependency IDs
    if !this.trees.is_empty() && this.trees[0].dependency_id != tree::ROOT_DEP_ID {
        let mut visited = Bitset::init_empty(this.dependencies.len())?;
        // PORT NOTE: reshaped for borrowck — iterate by index so
        // `legacy_package_to_dependency_id` can borrow `&self` while we hold
        // `&mut this.trees[i]`.
        for i in 0..this.trees.len() {
            let package_id = this.trees[i].dependency_id;
            this.trees[i].dependency_id =
                this.legacy_package_to_dependency_id(Some(&mut visited), package_id)?;
        }
        visited.set_range_value(
            bun_collections::bit_set::Range {
                start: 0,
                end: this.dependencies.len(),
            },
            false,
        );
        for i in 0..this.hoisted_dependencies.len() {
            let pid = this.hoisted_dependencies[i];
            this.hoisted_dependencies[i] =
                this.legacy_package_to_dependency_id(Some(&mut visited), pid)?;
        }
        // `visited` drops here.
    }

    Ok(this)
}

// ported from: src/install/lockfile/Buffers.zig
