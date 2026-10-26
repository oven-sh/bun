use core::fmt;

use crate::Error;
use bun_alloc::AllocError;
use bun_collections::{DynamicBitSet, StringHashMap, VecExt};
use bun_core::ZStr;
#[cfg(windows)]
use bun_core::w;
#[cfg(not(windows))]
use bun_paths::MAX_PATH_BYTES;
use bun_paths::platform::Auto as PlatformAuto;
use bun_paths::resolve_path::{self, join_abs_string_buf_z_checked as join_z_checked};
use bun_paths::strings;
use bun_paths::{self as path, AbsPath, SEP};
use bun_semver::{ExternalString, String};
#[cfg(not(windows))]
use bun_sys::Mode;
use bun_sys::{self as sys, Fd, FdExt as _};

use crate::bun_json::{Expr, ExprData};
use crate::dependency::{Behavior, Dependency, DependencyExt as _};
use crate::install::{DependencyID, ExternalStringList};
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::resolution;
#[cfg(windows)]
use crate::windows_shim::BinLinkingShim as WinBinLinkingShim;
#[cfg(windows)]
use crate::windows_shim::Shebang as WinShimShebang;

bun_output::declare_scope!(BinLinker, hidden);

/// Normalized `bin` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
/// Can be a:
/// - file path (relative to the package root)
/// - directory (relative to the package root)
/// - map where keys are names of the binaries and values are file paths to the binaries
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Bin {
    pub tag: Tag,
    pub(crate) _padding_tag: [u8; 3],

    // Written to disk byte for byte. `Value::init_*` sets every byte, but a `Value { .. }` literal
    // doesn't.
    pub(crate) value: Value,
}

impl Default for Bin {
    fn default() -> Self {
        Bin::init()
    }
}

impl Bin {
    pub(crate) fn count<B: StringBuilder>(
        &self,
        buf: &[u8],
        extern_strings: &[ExternalString],
        builder: &mut B,
    ) -> u32 {
        // SAFETY: tag determines the active union field
        unsafe {
            match self.tag {
                Tag::File => builder.count(self.value.file.slice(buf)),
                Tag::NamedFile => {
                    builder.count(self.value.named_file[0].slice(buf));
                    builder.count(self.value.named_file[1].slice(buf));
                }
                Tag::Dir => builder.count(self.value.dir.slice(buf)),
                Tag::Map => {
                    let list = self.value.map.get(extern_strings);
                    for extern_string in list {
                        builder.count(extern_string.slice(buf));
                    }
                    return list.len() as u32; // @truncate
                }
                _ => {}
            }
        }

        0
    }

    pub(crate) fn eql(
        l: &Bin,
        r: &Bin,
        l_buf: &[u8],
        l_extern_strings: &[ExternalString],
        r_buf: &[u8],
        r_extern_strings: &[ExternalString],
    ) -> bool {
        if l.tag != r.tag {
            return false;
        }

        // SAFETY: tag was just checked to match the active union field
        unsafe {
            match l.tag {
                Tag::None => true,
                Tag::File => l.value.file.eql(r.value.file, l_buf, r_buf),
                Tag::Dir => l.value.dir.eql(r.value.dir, l_buf, r_buf),
                Tag::NamedFile => {
                    l.value.named_file[0].eql(r.value.named_file[0], l_buf, r_buf)
                        && l.value.named_file[1].eql(r.value.named_file[1], l_buf, r_buf)
                }
                Tag::Map => {
                    let l_list = l.value.map.get(l_extern_strings);
                    let r_list = r.value.map.get(r_extern_strings);
                    if l_list.len() != r_list.len() {
                        return false;
                    }

                    // assuming these maps are small without duplicate keys
                    let mut i: usize = 0;
                    'outer: while i < l_list.len() {
                        let mut j: usize = 0;
                        while j < r_list.len() {
                            if l_list[i].hash == r_list[j].hash {
                                if l_list[i + 1].hash != r_list[j + 1].hash {
                                    return false;
                                }

                                i += 2;
                                continue 'outer;
                            }
                            j += 2;
                        }

                        // not found
                        return false;
                    }

                    true
                }
            }
        }
    }

    /// Callers pass the precomputed offset of the writable tail within
    /// `all_extern_strings` (a full-buffer view would alias the writable
    /// tail, which is UB under Stacked Borrows) and we build the
    /// `ExternalStringList` directly. Named `clone_with_buffers` to avoid
    /// shadowing `Clone::clone`.
    pub(crate) fn clone_with_buffers<B: StringBuilder>(
        &self,
        buf: &[u8],
        prev_external_strings: &[ExternalString],
        extern_strings_slice_off: u32,
        extern_strings_slice: &mut [ExternalString],
        builder: &mut B,
    ) -> Bin {
        // SAFETY: tag determines the active union field
        unsafe {
            match self.tag {
                Tag::None => Bin::init(),
                Tag::File => Bin::new(
                    Tag::File,
                    Value::init_file(builder.append_string(self.value.file.slice(buf))),
                ),
                Tag::NamedFile => Bin::new(
                    Tag::NamedFile,
                    Value::init_named_file([
                        builder.append_string(self.value.named_file[0].slice(buf)),
                        builder.append_string(self.value.named_file[1].slice(buf)),
                    ]),
                ),
                Tag::Dir => Bin::new(
                    Tag::Dir,
                    Value::init_dir(builder.append_string(self.value.dir.slice(buf))),
                ),
                Tag::Map => {
                    for (i, extern_string) in
                        self.value.map.get(prev_external_strings).iter().enumerate()
                    {
                        extern_strings_slice[i] =
                            builder.append_external_string(extern_string.slice(buf));
                    }

                    Bin::new(
                        Tag::Map,
                        Value::init_map(ExternalStringList::new(
                            extern_strings_slice_off,
                            extern_strings_slice.len() as u32,
                        )),
                    )
                }
            }
        }
    }

    /// Used for packages read from text lockfile / pnpm migration.
    pub(crate) fn parse_append(
        bin_expr: &Expr,
        buf: &mut bun_semver::string::Buf,
        extern_strings: &mut Vec<ExternalString>,
    ) -> Result<Bin, AllocError> {
        match &bin_expr.data {
            ExprData::EObject(o) => {
                let props = o.properties.slice();
                return Self::parse_append_object(
                    props.iter().map(|prop| {
                        (
                            prop.key.as_ref().and_then(Expr::as_utf8_string_literal),
                            prop.value.as_ref().and_then(Expr::as_utf8_string_literal),
                        )
                    }),
                    buf,
                    extern_strings,
                );
            }
            ExprData::EObjectJSON(o) => {
                let rows = o.get().properties();
                return Self::parse_append_object(
                    rows.iter()
                        .map(|row| (Some(row.key.slice()), row.value.as_str())),
                    buf,
                    extern_strings,
                );
            }
            _ => {}
        }
        if let Some(str_) = bin_expr.as_utf8_string_literal() {
            if !str_.is_empty() {
                return Ok(Bin::new(Tag::File, Value::init_file(buf.append(str_)?)));
            }
        }
        Ok(Bin::default())
    }

    fn parse_append_object<'a>(
        pairs: impl Iterator<Item = (Option<&'a [u8]>, Option<&'a [u8]>)> + Clone,
        buf: &mut bun_semver::string::Buf,
        extern_strings: &mut Vec<ExternalString>,
    ) -> Result<Bin, AllocError> {
        // npm (normalize-package-bin) skips an entry whose value is not a string.
        let mut entries = pairs.filter_map(|(key, value)| Some((key?, value?)));
        match entries.clone().count() {
            0 => {}
            1 => {
                if let Some((bin_name, value)) = entries.next() {
                    return Ok(Bin::new(
                        Tag::NamedFile,
                        Value::init_named_file([buf.append(bin_name)?, buf.append(value)?]),
                    ));
                }
            }
            len => {
                let current_len = extern_strings.len();
                let num_props: usize = len * 2;
                extern_strings
                    .try_reserve_exact(num_props)
                    .map_err(|_| AllocError)?;
                for (key_str, value_str) in entries {
                    extern_strings.push(buf.append_external(key_str)?);
                    extern_strings.push(buf.append_external(value_str)?);
                }
                debug_assert!(extern_strings.len() == current_len + num_props);
                let new = &extern_strings[current_len..current_len + num_props];
                return Ok(Bin::new(
                    Tag::Map,
                    Value::init_map(ExternalStringList::init(extern_strings.as_slice(), new)),
                ));
            }
        }
        Ok(Bin::default())
    }

    pub(crate) fn parse_append_from_directories(
        bin_expr: &Expr,
        buf: &mut bun_semver::string::Buf,
    ) -> Result<Bin, AllocError> {
        if let Some(bin_str) = bin_expr.as_utf8_string_literal() {
            return Ok(Bin::new(Tag::Dir, Value::init_dir(buf.append(bin_str)?)));
        }
        Ok(Bin::default())
    }

    pub(crate) fn to_json<W: fmt::Write, const STYLE: ToJsonStyle>(
        &self,
        indent: Option<&mut u32>,
        buf: &[u8],
        extern_strings: &[ExternalString],
        writer: &mut W,
        write_indent: fn(&mut W, &mut u32) -> fmt::Result,
    ) -> fmt::Result {
        debug_assert!(self.tag != Tag::None);
        // SAFETY: tag determines the active union field
        unsafe {
            if STYLE == ToJsonStyle::SingleLine {
                match self.tag {
                    Tag::None => {}
                    Tag::File => {
                        write!(
                            writer,
                            "{}",
                            self.value.file.fmt_json(buf, Default::default())
                        )?;
                    }
                    Tag::NamedFile => {
                        writer.write_char('{')?;
                        write!(
                            writer,
                            " {}: {} ",
                            self.value.named_file[0].fmt_json(buf, Default::default()),
                            self.value.named_file[1].fmt_json(buf, Default::default()),
                        )?;
                        writer.write_char('}')?;
                    }
                    Tag::Dir => {
                        write!(
                            writer,
                            "{}",
                            self.value.dir.fmt_json(buf, Default::default())
                        )?;
                    }
                    Tag::Map => {
                        writer.write_char('{')?;
                        let list = self.value.map.get(extern_strings);
                        let mut first = true;
                        let mut i: usize = 0;
                        while i < list.len() {
                            if !first {
                                writer.write_char(',')?;
                            }
                            first = false;
                            write!(
                                writer,
                                " {}: {}",
                                list[i].value.fmt_json(buf, Default::default()),
                                list[i + 1].value.fmt_json(buf, Default::default()),
                            )?;
                            i += 2;
                        }
                        writer.write_str(" }")?;
                    }
                }

                return Ok(());
            }

            let indent = indent.unwrap();

            match self.tag {
                Tag::None => {}
                Tag::File => {
                    write!(
                        writer,
                        "{}",
                        self.value.file.fmt_json(buf, Default::default())
                    )?;
                }
                Tag::NamedFile => {
                    writer.write_str("{\n")?;
                    *indent += 1;
                    write_indent(writer, indent)?;
                    writeln!(
                        writer,
                        "{}: {},",
                        self.value.named_file[0].fmt_json(buf, Default::default()),
                        self.value.named_file[1].fmt_json(buf, Default::default()),
                    )?;
                    *indent -= 1;
                    write_indent(writer, indent)?;
                    writer.write_char('}')?;
                }
                Tag::Dir => {
                    write!(
                        writer,
                        "{}",
                        self.value.dir.fmt_json(buf, Default::default())
                    )?;
                }
                Tag::Map => {
                    writer.write_char('{')?;
                    *indent += 1;

                    let list = self.value.map.get(extern_strings);
                    let mut any = false;
                    let mut i: usize = 0;
                    while i < list.len() {
                        if !any {
                            any = true;
                            writer.write_char('\n')?;
                        }
                        write_indent(writer, indent)?;
                        writeln!(
                            writer,
                            "{}: {},",
                            list[i].value.fmt_json(buf, Default::default()),
                            list[i + 1].value.fmt_json(buf, Default::default()),
                        )?;
                        i += 2;
                    }
                    if !any {
                        writer.write_char('}')?;
                        *indent -= 1;
                        return Ok(());
                    }

                    *indent -= 1;
                    write_indent(writer, indent)?;
                    writer.write_char('}')?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn init() -> Bin {
        Bin::new(Tag::None, Value::init_none())
    }

    fn new(tag: Tag, value: Value) -> Bin {
        Bin {
            tag,
            _padding_tag: [0; 3],
            value,
        }
    }

    // ── Tag-checked union accessors ────────────────────────────────────────
    // `Value` is a `Copy` POD union (largest member `ExternalStringList` is two
    // `u32`s); reading the wrong variant is well-defined garbage.
    bun_core::extern_union_accessors! {
        tag: tag as Tag, value: value;
        File      => file: String;
        NamedFile => named_file: [String; 2];
        Dir       => dir: String;
        Map       => map: ExternalStringList;
    }
}

#[derive(core::marker::ConstParamTy, PartialEq, Eq)]
pub enum ToJsonStyle {
    SingleLine,
    MultiLine,
}

// The canonical
// `bun_semver::StringBuilder` trait (count + append<T> + provided
// append_string/append_external_string wrappers). Re-exported so
// `bin_real::StringBuilder` paths still resolve.
pub use bun_semver::StringBuilder;

#[repr(C)]
#[derive(Clone, Copy)]
pub union Value {
    /// no "bin", or empty "bin"
    pub none: (),

    /// "bin" is a string
    /// ```json
    /// "bin": "./bin/foo",
    /// ```
    pub(crate) file: String,

    // Single-entry map
    ///```json
    /// "bin": {
    ///     "babel": "./cli.js",
    /// }
    ///```
    pub(crate) named_file: [String; 2],

    /// "bin" is a directory
    ///```json
    /// "dirs": {
    ///     "bin": "./bin",
    /// }
    ///```
    pub(crate) dir: String,
    // "bin" is a map
    ///```json
    /// "bin": {
    ///     "babel": "./cli.js",
    ///     "babel-cli": "./cli.js",
    /// }
    ///```
    pub(crate) map: ExternalStringList,
}

impl Value {
    /// To avoid undefined memory between union values, we must zero initialize the union first.
    #[inline]
    pub(crate) fn init_none() -> Value {
        // SAFETY: all-zero is a valid Value (largest member ExternalStringList is POD)
        unsafe { bun_core::ffi::zeroed_unchecked() }
    }
    #[inline]
    pub(crate) fn init_file(file: String) -> Value {
        let mut v = Self::init_none();
        v.file = file;
        v
    }
    #[inline]
    pub(crate) fn init_named_file(named_file: [String; 2]) -> Value {
        let mut v = Self::init_none();
        v.named_file = named_file;
        v
    }
    #[inline]
    pub(crate) fn init_dir(dir: String) -> Value {
        let mut v = Self::init_none();
        v.dir = dir;
        v
    }
    #[inline]
    pub(crate) fn init_map(map: ExternalStringList) -> Value {
        let mut v = Self::init_none();
        v.map = map;
        v
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tag {
    /// no bin field
    None = 0,

    /// "bin" is a string
    /// ```json
    /// "bin": "./bin/foo",
    /// ```
    File = 1,

    // Single-entry map
    ///```json
    /// "bin": {
    ///     "babel": "./cli.js",
    /// }
    ///```
    NamedFile = 2,

    /// "bin" is a directory
    ///```json
    /// "dirs": {
    ///     "bin": "./bin",
    /// }
    ///```
    Dir = 3,

    // "bin" is a map of more than one
    ///```json
    /// "bin": {
    ///     "babel": "./cli.js",
    ///     "babel-cli": "./cli.js",
    ///     "webpack-dev-server": "./cli.js",
    /// }
    ///```
    Map = 4,
}

pub(crate) struct NamesIterator<'a> {
    pub(crate) bin: Bin,
    pub(crate) i: usize,
    pub(crate) done: bool,
    pub(crate) dir_iterator: Option<sys::dir_iterator::WrappedIterator>,
    pub(crate) package_name: String,
    /// Borrowed view of the destination `node_modules` directory fd; the
    /// caller owns the underlying `Dir`. Default is `Fd::INVALID`, which
    /// `next_in_dir()` never reaches.
    pub(crate) destination_node_modules: Fd,
    pub(crate) buf: bun_paths::path_buffer_pool::Guard,
    pub(crate) string_buffer: &'a [u8],
    pub(crate) extern_string_buf: &'a [ExternalString],
}

impl<'a> NamesIterator<'a> {
    fn next_in_dir(&mut self) -> Result<Option<&[u8]>, Error> {
        if self.done {
            return Ok(None);
        }
        if self.dir_iterator.is_none() {
            let dir_str = *self.bin.dir();
            let mut target = dir_str.slice(self.string_buffer);
            if strings::has_prefix(target, b"./") || strings::has_prefix(target, b".\\") {
                target = &target[2..];
            }
            let parts: [&[u8]; 2] = [self.package_name.slice(self.string_buffer), target];

            let dir = self.destination_node_modules;

            let joined = resolve_path::join_string_buf::<PlatformAuto>(&mut self.buf[..], &parts);
            let joined_len = joined.len();
            self.buf[joined_len] = 0;
            let joined_ = ZStr::from_buf_mut(&mut self.buf, joined_len);
            let child_dir = sys::Dir::borrow(&dir)
                .open_at(joined_)
                .map_err(Error::from)?
                .into_raw();
            self.dir_iterator = Some(sys::iterate_dir(child_dir));
        }

        let iter = self.dir_iterator.as_mut().unwrap();
        if let Some(entry) = iter.next().unwrap_or(None) {
            self.i += 1;
            let name = entry.name.slice_u8();
            Ok(Some(strings::copy(&mut self.buf[..], name)))
        } else {
            self.done = true;
            let dir = self.dir_iterator.take().unwrap().dir();
            dir.close();
            Ok(None)
        }
    }

    /// next filename, e.g. "babel" instead of "cli.js"
    pub(crate) fn next(&mut self) -> Result<Option<&[u8]>, Error> {
        let name: String = match self.bin.tag {
            Tag::File | Tag::NamedFile => {
                if self.i > 0 {
                    return Ok(None);
                }
                self.i += 1;
                self.done = true;
                if self.bin.tag == Tag::File {
                    self.package_name
                } else {
                    self.bin.named_file()[0]
                }
            }
            Tag::Dir => return self.next_in_dir(),
            Tag::Map => {
                let map = *self.bin.map();
                if self.i >= map.len as usize {
                    return Ok(None);
                }
                let index = self.i;
                self.i += 2;
                self.done = self.i >= map.len as usize;
                map.get(self.extern_string_buf)[index].value
            }
            _ => return Ok(None),
        };

        let mut base = path::basename(name.slice(self.string_buffer));
        if strings::has_prefix(base, b"./") || strings::has_prefix(base, b".\\") {
            base = &base[2..];
        }
        Ok(Some(strings::copy(&mut self.buf[..], base)))
    }
}

/// The order in which the packages in one `node_modules` link their bins. The first package to link
/// a name keeps it.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct LinkOrder<'a> {
    /// True if neither the root package nor a workspace declares the dependency.
    transitive: bool,
    /// A workspace, `file:` or `link:` directory, not a registry, tarball or git package.
    local_directory: bool,
    pub(crate) dependency_name: &'a [u8],
}

impl<'a> LinkOrder<'a> {
    pub(crate) fn new(
        direct: bool,
        resolution: resolution::Tag,
        dependency_name: &'a [u8],
    ) -> LinkOrder<'a> {
        LinkOrder {
            transitive: !direct,
            local_directory: matches!(
                resolution,
                resolution::Tag::Root
                    | resolution::Tag::Workspace
                    | resolution::Tag::Folder
                    | resolution::Tag::Symlink
            ),
            dependency_name,
        }
    }

    /// Returns true if a dependency of the root package or of a workspace counts as direct.
    pub(crate) fn declares(behavior: Behavior) -> bool {
        behavior.is_prod() || behavior.is_dev() || behavior.is_optional() || behavior.is_workspace()
    }

    /// Compares by package, because a hoisted package keeps the id of the first dependency that
    /// reached it.
    pub(crate) fn direct_packages(lockfile: &Lockfile) -> Result<DynamicBitSet, AllocError> {
        let pkgs = lockfile.packages.slice();
        let mut direct = DynamicBitSet::init_empty(pkgs.len())?;
        for ((resolution, dependencies), resolutions) in pkgs
            .items_resolution()
            .iter()
            .zip(pkgs.items_dependencies())
            .zip(pkgs.items_resolutions())
        {
            if !matches!(
                resolution.tag,
                resolution::Tag::Root | resolution::Tag::Workspace
            ) {
                continue;
            }
            for (dependency, &package_id) in dependencies
                .get(lockfile.buffers.dependencies.as_slice())
                .iter()
                .zip(resolutions.get(lockfile.buffers.resolutions.as_slice()))
            {
                if Self::declares(dependency.behavior) && (package_id as usize) < pkgs.len() {
                    direct.set(package_id as usize);
                }
            }
        }
        Ok(direct)
    }
}

// BACKREF — the `PackageInstaller` that owns these queues also borrows the `Lockfile` mutably.
pub struct PriorityQueueContext {
    pub(crate) lockfile: bun_ptr::BackRef<Lockfile>,
    pub(crate) direct_packages: bun_ptr::BackRef<DynamicBitSet>,
}

impl PriorityQueueContext {
    fn link_order(&self, dependency_id: DependencyID) -> LinkOrder<'_> {
        // Read these again on every comparison, because the buffers and the package list can grow
        // during the install.
        let lockfile = self.lockfile.get();
        let package_id = lockfile.buffers.resolutions.as_slice()[dependency_id as usize] as usize;
        LinkOrder::new(
            self.direct_packages
                .is_set_allow_out_of_bound(package_id, false),
            lockfile.packages.items_resolution()[package_id].tag,
            lockfile.buffers.dependencies.as_slice()[dependency_id as usize]
                .name
                .slice(lockfile.buffers.string_bytes.as_slice()),
        )
    }
}

impl bun_collections::PriorityCompare<DependencyID> for PriorityQueueContext {
    #[inline]
    fn compare(&self, a: &DependencyID, b: &DependencyID) -> core::cmp::Ordering {
        self.link_order(*a).cmp(&self.link_order(*b))
    }
}

// Port of `std.PriorityQueue(DependencyID, PriorityQueueContext, lessThan)`.
// Min-heap keyed by `LinkOrder`.
pub(crate) type PriorityQueue = bun_collections::PriorityQueue<DependencyID, PriorityQueueContext>;

// https://github.com/npm/npm-normalize-package-bin/blob/574e6d7cd21b2f3dee28a216ec2053c2551f7af9/lib/index.js#L38
fn normalized_bin_name(name: &[u8]) -> &[u8] {
    let name = match strings::last_index_of_any(name, b"/\\:") {
        Some(i) => &name[i + 1..],
        None => name,
    };

    // npm's `join('/', key).slice(1)` collapses `.`/`..` to empty; do the same
    // so the `.bin/<name>` destination cannot resolve outside `.bin/`.
    debug_assert!(strings::index_of_any(name, b"/\\:").is_none());
    if matches!(name, b"" | b"." | b"..") || crate::dependency::contains_control_character(name) {
        return b"";
    }

    name
}

/// True when a `bin` entry's target value would resolve outside the package
/// directory (absolute path or `..` traversal). The bin *value* is taken
/// verbatim from package.json, so without this check a malicious package could
/// point a bin link at (and chmod) an arbitrary file on disk (the bug class
/// npm fixed as CVE-2019-16775).
pub fn bin_target_escapes_package_dir(target: &[u8]) -> bool {
    // Windows drive-relative paths (`C:foo`, `C:..\evil`) are not "absolute"
    // (no separator after the colon) and their `C:..` component is not a bare
    // `..`, so they would slip past the depth walk below while still resolving
    // outside the package directory. A colon in the *first* component can only
    // be a drive prefix (or an NTFS alternate-data-stream on the leading
    // segment) — reject it. Colons in later components are left alone so Unix
    // filenames containing `:` keep working.
    if strings::split_any(target, b"/\\")
        .next()
        .is_some_and(|first| strings::contains_char(first, b':'))
    {
        return true;
    }
    path_climbs_out(target)
}

/// Returns true if `target` is absolute, or if its `..` components lead above the directory it
/// starts in.
pub(crate) fn path_climbs_out(target: &[u8]) -> bool {
    if path::is_absolute(target) {
        return true;
    }
    // The OS stops reading a path at a NUL byte, so `..\0x` would open `..` even though the loop
    // below counts it as an ordinary name.
    if strings::contains_char(target, 0) {
        return true;
    }
    let mut depth: isize = 0;
    for component in strings::split_any(target, b"/\\") {
        match component {
            b"" | b"." => {}
            b".." => {
                depth -= 1;
                if depth < 0 {
                    return true;
                }
            }
            _ => depth += 1,
        }
    }
    false
}

fn bin_target_needs_resolved_containment_check(target: &[u8]) -> bool {
    let mut components = strings::tokenize_any(target, b"/\\");
    let Some(first) = components.next() else {
        return false;
    };
    first == b"." || first == b".." || components.next().is_some()
}

pub struct Linker<'a> {
    pub bin: Bin,

    /// Usually will be the same as `node_modules_path`.
    /// Used to support native bin linking.
    ///
    /// This intentionally may alias `node_modules_path` (the common
    /// case). A `&'a AbsPath` would
    /// conflict with the `&'a mut AbsPath` borrow on `node_modules_path`, so
    /// keep it as a raw pointer; the only read site dereferences it under a
    /// SAFETY note in `build_target_package_dir`.
    pub target_node_modules_path: *const AbsPath,

    /// Usually will be the same as `package_name`.
    /// Used to support native bin linking.
    pub target_package_name: strings::StringOrTinyString,

    // Hash map of seen destination paths for this `node_modules/.bin` folder. PackageInstaller will reset it before
    // linking each tree.
    pub seen: Option<&'a mut StringHashMap<()>>,

    pub node_modules_path: &'a mut AbsPath,

    /// Used for generating relative paths
    pub package_name: strings::StringOrTinyString,

    pub global_bin_path: &'a ZStr,

    pub string_buf: &'a [u8],
    pub extern_string_buf: &'a [ExternalString],

    pub abs_target_buf: &'a mut [u8],
    pub abs_dest_buf: &'a mut [u8],
    pub rel_buf: &'a mut [u8],

    /// Whether `node_modules_path` is a symlink (see `LinkedNodeModules`). `None` means not checked
    /// yet. Behind a symlink, a directory that has a bin's name is kept, and linking fails.
    pub is_behind_link: Option<bool>,

    pub err: Option<Error>,
    pub skipped_due_to_missing_bin: bool,
}

#[cfg(not(windows))]
static EXEC_MODE: bun_core::Once<Mode> = bun_core::Once::new();

/// The mode of a bin target, `0o777 & !umask`.
#[cfg(not(windows))]
fn exec_mode() -> Mode {
    EXEC_MODE.call(|| {
        let prev = sys::umask(0);
        sys::umask(prev);
        0o777 & !prev
    })
}

impl<'a> Linker<'a> {
    /// libc can only read the umask by setting it, so call this while the process has a single
    /// thread.
    pub fn ensure_umask() {
        #[cfg(not(windows))]
        exec_mode();
    }

    fn is_behind_link(known: &mut Option<bool>, node_modules_path: &mut AbsPath) -> bool {
        *known.get_or_insert_with(|| {
            crate::prune::LinkedNodeModules::is_at(node_modules_path.slice_z()) == Some(true)
        })
    }

    /// The global bin directory also has files that Bun didn't create, so only a link into
    /// `global_owner` is removed.
    fn unlink_bin_or_shim(abs_dest: &ZStr, global_owner: Option<&[u8]>) {
        #[cfg(not(windows))]
        {
            if let Some(owner) = global_owner {
                let mut link_buf = path::path_buffer_pool::get();
                match sys::readlink(abs_dest, link_buf.as_mut_slice()) {
                    Ok(len) if Self::link_leads_into(abs_dest, &link_buf[..len], owner) => {}
                    _ => return,
                }
            }
            let _ = sys::unlink(abs_dest);
        }

        #[cfg(windows)]
        {
            let mut dest_buf = bun_paths::w_path_buffer_pool::get();
            let abs_dest_w = strings::convert_utf8_to_utf16_in_buffer(
                dest_buf.as_mut_slice(),
                abs_dest.as_bytes(),
            );
            let abs_dest_w_len = abs_dest_w.len();
            let bunx_suffix = w!(".bunx\x00");
            dest_buf[abs_dest_w_len..abs_dest_w_len + bunx_suffix.len()]
                .copy_from_slice(bunx_suffix);
            // SAFETY: dest_buf[abs_dest_w_len + ".bunx".len()] == 0 written above
            let abs_bunx_file =
                bun_core::WStr::from_buf(&dest_buf[..], abs_dest_w_len + b".bunx".len());
            let had_bunx_file = sys::unlink_w(abs_bunx_file).is_ok();
            // An `.exe` without its `.bunx` is a program, `bun.exe` for one.
            if global_owner.is_some() && !had_bunx_file {
                return;
            }
            let exe_suffix = w!(".exe\x00");
            dest_buf[abs_dest_w_len..abs_dest_w_len + exe_suffix.len()].copy_from_slice(exe_suffix);
            // SAFETY: dest_buf[abs_dest_w_len + ".exe".len()] == 0 written above
            let abs_exe_file =
                bun_core::WStr::from_buf(&dest_buf[..], abs_dest_w_len + b".exe".len());
            let _ = sys::unlink_w(abs_exe_file);
        }
    }

    /// Returns true if the symlink at `abs_dest` with the target `link` points into `abs_dir`. The
    /// check is lexical.
    #[cfg(not(windows))]
    pub(crate) fn link_leads_into(abs_dest: &ZStr, link: &[u8], abs_dir: &[u8]) -> bool {
        let mut resolved_buf = path::path_buffer_pool::get();
        resolve_path::join_abs_string_buf_checked::<PlatformAuto>(
            resolve_path::dirname::<PlatformAuto>(abs_dest.as_bytes()),
            resolved_buf.as_mut_slice(),
            &[link],
        )
        .is_some_and(|resolved| {
            matches!(
                resolve_path::is_parent_or_equal(abs_dir, resolved),
                resolve_path::ParentEqual::Parent
            )
        })
    }

    fn link_bin_or_create_shim(
        &mut self,
        abs_target: &ZStr,
        abs_dest: &ZStr,
        global: bool,
        target_needs_resolved_containment_check: bool,
    ) {
        debug_assert!(path::is_absolute(abs_target.as_bytes()));
        debug_assert!(path::is_absolute(abs_dest.as_bytes()));
        debug_assert!(abs_target.as_bytes()[abs_target.as_bytes().len() - 1] != SEP);
        debug_assert!(abs_dest.as_bytes()[abs_dest.as_bytes().len() - 1] != SEP);

        // Skip if the target does not exist. This is important because placing a dangling
        // shim in path might break a postinstall
        #[cfg(not(windows))]
        let Ok(target_stat) = sys::stat(abs_target) else {
            self.skipped_due_to_missing_bin = true;
            return;
        };

        if target_needs_resolved_containment_check {
            #[cfg(not(windows))]
            if self.resolved_target_parent_escapes_package_dir(abs_target) {
                return;
            }
        }

        if let Some(seen) = self.seen.as_deref() {
            // Skip seen destinations for this tree
            // https://github.com/npm/cli/blob/22731831e22011e32fa0ca12178e242c2ee2b33d/node_modules/bin-links/lib/link-gently.js#L30
            if seen.contains_key(abs_dest.as_bytes()) {
                // The name is taken, and `bunx <this package>` starts the file itself.
                #[cfg(not(windows))]
                Self::make_executable(abs_target, &target_stat);
                return;
            }
        }

        #[cfg(windows)]
        if !sys::exists(abs_target) {
            self.skipped_due_to_missing_bin = true;
            return;
        }

        if let Some(seen) = self.seen.as_deref_mut() {
            // StringHashMap::get_or_put boxes the key on insert.
            let _ = seen.get_or_put(abs_dest.as_bytes());
        }

        bun_core::analytics::Features::binlinks_inc();

        #[cfg(not(windows))]
        let result = self.create_symlink(abs_target, abs_dest, global);
        #[cfg(windows)]
        let result = match sys::File::openat(Fd::cwd(), abs_target, sys::O::RDONLY, 0) {
            Ok(target) => self.create_windows_shim(&target, abs_target, abs_dest, global),
            Err(err) => match crate::Error::from(err) {
                // ignore directories, creating a shim for one won't do anything
                crate::Error::Sys(bun_errno::SystemErrno::EISDIR) => Ok(()),
                err => Err(err),
            },
        };

        // The package's other bins are still linked, and the first error is reported.
        if let Err(err) = result {
            self.err.get_or_insert(err);
            #[cfg(windows)]
            Self::unlink_bin_or_shim(
                abs_dest,
                (global || Self::is_behind_link(&mut self.is_behind_link, self.node_modules_path))
                    .then_some(&b""[..]),
            );
            if let Some(seen) = self.seen.as_deref_mut() {
                seen.remove(abs_dest.as_bytes());
            }
            return;
        }

        #[cfg(not(windows))]
        Self::make_executable(abs_target, &target_stat);
    }

    #[cfg(not(windows))]
    fn make_executable(abs_target: &ZStr, target_stat: &sys::Stat) {
        let mode = exec_mode();
        if (target_stat.st_mode as Mode) & 0o777 != mode {
            let _ = sys::lchmod(abs_target, mode);
        }
        Self::try_normalize_shebang(abs_target, target_stat.st_size as u64);
    }

    #[cfg(not(windows))]
    fn try_normalize_shebang(abs_target: &ZStr, size: u64) {
        let mut shebang_buf = [0u8; 2048];

        // any error here is ignored
        let chunk_len = 'brk: {
            let Ok(bin_for_reading) = sys::File::openat(Fd::cwd(), abs_target, sys::O::RDONLY, 0)
            else {
                return;
            };
            let Ok(mut read) = bin_for_reading.read(&mut shebang_buf) else {
                return;
            };
            // `size` tells the end of a small file from a short read, without a second read.
            if (read as u64) < size.min(shebang_buf.len() as u64) {
                let Ok(rest) = bin_for_reading.read_all(&mut shebang_buf[read..]) else {
                    return;
                };
                read += rest;
            }
            break 'brk read;
        };
        let chunk = &shebang_buf[0..chunk_len];

        // 123 4 5
        // #!a\r\n
        if chunk.len() < 5 || chunk[0] != b'#' || chunk[1] != b'!' {
            return;
        }

        let Some(newline) = strings::index_of_char(chunk, b'\n') else {
            return;
        };
        let newline = newline as usize;
        let chunk_without_newline = &chunk[0..newline];
        if !(!chunk_without_newline.is_empty()
            && chunk_without_newline[chunk_without_newline.len() - 1] == b'\r')
        {
            // Nothing to do!
            return;
        }
        bun_output::scoped_log!(
            BinLinker,
            "Normalizing shebang for {}",
            bstr::BStr::new(abs_target.as_bytes())
        );

        // We have to do an atomic replace here, use a randomly generated
        // filename in the same folder, read the entire original file
        // contents using bun.sys.File.readFrom, then write the temporary file, then
        // overwite the old one with the new one via bun.sys.renameat. And
        // always unlink the old one. If it fails for any reason then exit
        // early.
        let mut tmpname_buf = [0u8; 1024];
        let Ok(tmpname) = path::fs::FileSystem::tmpname(
            path::basename(abs_target.as_bytes()),
            &mut tmpname_buf,
            bun_wyhash::hash(chunk_without_newline),
        ) else {
            return;
        };

        let dir_path = resolve_path::dirname::<PlatformAuto>(abs_target.as_bytes());
        if dir_path.is_empty() {
            return;
        }

        let original_contents;
        let content: &[u8] = if chunk.len() >= shebang_buf.len() {
            // Partial read. Need to read the rest of the file.
            let Ok(contents) = sys::File::read_from(Fd::cwd(), abs_target) else {
                return;
            };
            original_contents = contents;
            &original_contents
        } else {
            chunk
        };

        // Get original file permissions to preserve them (including setuid/setgid/sticky bits)
        let Ok(original_stat) = sys::fstatat(Fd::cwd(), abs_target) else {
            return;
        };
        let original_mode: Mode = original_stat.st_mode as Mode;

        // Create temporary file path
        let mut tmppath_buf = [0u8; MAX_PATH_BYTES];
        let Some(tmppath) =
            join_z_checked::<PlatformAuto>(dir_path, &mut tmppath_buf, &[tmpname.as_bytes()])
        else {
            return;
        };
        struct UnlinkUnlessRenamed<'p>(Option<&'p ZStr>);
        impl Drop for UnlinkUnlessRenamed<'_> {
            fn drop(&mut self) {
                if let Some(tmppath) = self.0 {
                    let _ = sys::unlinkat(Fd::cwd(), tmppath);
                }
            }
        }
        let mut tmpfile_guard = UnlinkUnlessRenamed(Some(tmppath));

        // Write to temporary file with corrected content
        {
            let Ok(tmpfile) = sys::File::openat(
                Fd::cwd(),
                tmppath,
                sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                original_mode,
            ) else {
                return;
            };
            // Write the corrected shebang (without \r)
            if tmpfile
                .write_all(&chunk_without_newline[0..chunk_without_newline.len() - 1])
                .is_err()
            {
                return;
            }
            if tmpfile.write_all(b"\n").is_err() {
                return;
            }

            // Write the rest of the file (after the newline)
            if content.len() > newline + 1 {
                if tmpfile.write_all(&content[newline + 1..]).is_err() {
                    return;
                }
            }

            // Reapply original permissions (umask was applied during openat, so we need to restore)
            if sys::fchmodat(
                Fd::cwd(),
                tmppath,
                (original_stat.st_mode & 0o777) as Mode,
                0,
            )
            .is_err()
            {
                return;
            }
        }

        // Atomic replace: rename temp file to original
        if sys::renameat(Fd::cwd(), tmppath, Fd::cwd(), abs_target).is_ok() {
            tmpfile_guard.0 = None;
        }
    }

    #[cfg(windows)]
    fn create_windows_shim(
        &mut self,
        target: &sys::File,
        abs_target: &ZStr,
        abs_dest: &ZStr,
        global: bool,
    ) -> Result<(), Error> {
        // `encode_into` reinterprets this byte buffer as `[u16]`.
        // Constructing a `&mut [u16]` from a pointer that is not 2-aligned is
        // *immediate language UB* — the reference validity invariant requires
        // alignment even if never dereferenced.
        // `[u8; N]` has `align_of == 1`, so the compiler is free to place it at
        // an odd address. Force 2-byte alignment at the declaration site so the
        // `*mut u16` slice construction in `encode_into` is provably sound.
        #[repr(align(2))]
        struct ShimBuf([u8; 65536]);
        let mut shim_buf = ShimBuf([0u8; 65536]);
        let shim_buf = &mut shim_buf.0;
        let mut read_in_buf = [0u8; WinShimShebang::MAX_SHEBANG_INPUT_LENGTH];
        let mut dest_buf = bun_paths::w_path_buffer_pool::get();
        let mut target_buf = bun_paths::w_path_buffer_pool::get();

        let abs_dest_w =
            strings::convert_utf8_to_utf16_in_buffer(dest_buf.as_mut_slice(), abs_dest.as_bytes());
        let abs_dest_w_len = abs_dest_w.len();
        let exe_suffix = w!(".exe\x00");
        dest_buf[abs_dest_w_len..abs_dest_w_len + exe_suffix.len()].copy_from_slice(exe_suffix);
        let foreign_exe_exists = (global
            || Self::is_behind_link(&mut self.is_behind_link, self.node_modules_path))
            && sys::exists_os_path(
                bun_core::WStr::from_buf(&dest_buf[..], abs_dest_w_len + b".exe".len()),
                false,
            );

        let bunx_suffix = w!(".bunx\x00");
        dest_buf[abs_dest_w_len..abs_dest_w_len + bunx_suffix.len()].copy_from_slice(bunx_suffix);

        // SAFETY: dest_buf[abs_dest_w_len + ".bunx".len()] == 0 written above
        let abs_bunx_file =
            bun_core::WStr::from_buf(&dest_buf[..], abs_dest_w_len + b".bunx".len());

        // An `.exe` without its `.bunx` is a program, `bun.exe` for one.
        if foreign_exe_exists && !sys::exists_os_path(abs_bunx_file, false) {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::EEXIST));
        }

        let open_bunx_file = || {
            sys::File::openat_os_path(
                Fd::invalid(),
                abs_bunx_file,
                sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                0o664,
            )
        };
        let bunx_file = match open_bunx_file() {
            Ok(f) => f,
            Err(err) => {
                let err: crate::Error = err.into();
                if err != crate::Error::Sys(bun_errno::SystemErrno::ENOENT) || global {
                    return Err(err);
                }

                let node_modules_path_save = self.node_modules_path.len();
                let _ = self.node_modules_path.append(b".bin");
                let _ = sys::Dir::cwd().make_path(self.node_modules_path.slice());
                self.node_modules_path.set_length(node_modules_path_save);

                open_bunx_file()?
            }
        };

        let rel_target = resolve_path::relative_buf_z(
            self.rel_buf,
            resolve_path::dirname::<PlatformAuto>(abs_dest.as_bytes()),
            abs_target.as_bytes(),
        );

        // The shim resolves `bin_path` relative to the parent of its directory. Other targets are
        // absolute.
        let (bin_path, is_absolute_target): (&[u8], bool) =
            match strings::without_prefix_if_possible_comptime(rel_target.as_bytes(), b"..\\") {
                Some(rel_to_parent) => (rel_to_parent, false),
                None => (abs_target.as_bytes(), true),
            };

        let bin_path_w = strings::to_w_path_normalized(target_buf.as_mut_slice(), bin_path);

        // Loop-fill via `read_all` so a short read can't truncate the shebang sniff.
        let shebang = match target.read_all(&mut read_in_buf) {
            Ok(read) if read > 0 => WinShimShebang::parse(&read_in_buf[0..read], bin_path_w)
                .map_err(|_| crate::Error::InvalidBinCount)?,
            _ => WinShimShebang::parse_from_bin_path(bin_path_w),
        };

        let shim = WinBinLinkingShim {
            bin_path: bin_path_w,
            is_absolute_target,
            shebang,
        };

        let len = shim.encoded_length();
        if len > shim_buf.len() {
            return Err(crate::Error::InvalidBinContent);
        }

        let metadata = &mut shim_buf[0..len];
        if shim.encode_into(metadata).is_err() {
            return Err(crate::Error::InvalidBinContent);
        }

        bunx_file.write_all(metadata)?;

        dest_buf[abs_dest_w_len..abs_dest_w_len + exe_suffix.len()].copy_from_slice(exe_suffix);
        // SAFETY: dest_buf[abs_dest_w_len + ".exe".len()] == 0 written above
        let abs_exe_file = bun_core::WStr::from_buf(&dest_buf[..], abs_dest_w_len + b".exe".len());

        if let Err(err) = sys::File::write_file_os_path(
            Fd::invalid(),
            abs_exe_file,
            crate::windows_shim::embedded_executable_data(),
        ) {
            let err: crate::Error = err.into();
            // exe is most likely running. bunx file has already been updated, ignore error
            if err != crate::Error::Sys(bun_errno::SystemErrno::EBUSY) {
                return Err(err);
            }
        }

        Ok(())
    }

    #[cfg(not(windows))]
    fn create_symlink(
        &mut self,
        abs_target: &ZStr,
        abs_dest: &ZStr,
        global: bool,
    ) -> Result<(), Error> {
        let abs_dest_dir = resolve_path::dirname::<PlatformAuto>(abs_dest.as_bytes());
        // One `..` per component of `abs_dest_dir` can outgrow `abs_target`.
        let rel_bound = abs_target.len() + 3 * (strings::count_char(abs_dest_dir, SEP) + 1) + 2;
        let mut rel_spill = Vec::new();
        let rel_buf = resolve_path::buf_or_spill(self.rel_buf, &mut rel_spill, rel_bound);
        let rel_target = resolve_path::relative_buf_z(rel_buf, abs_dest_dir, abs_target.as_bytes());

        let mut result = sys::symlink_running_executable(rel_target, abs_dest);

        // `.bin` hasn't been created yet. The global bin dir is not created here.
        if !global && matches!(&result, Err(err) if err.get_errno() == sys::Errno::ENOENT) {
            let node_modules_path_save = self.node_modules_path.len();
            let _ = self.node_modules_path.append(b".bin");
            let _ = sys::Dir::cwd().make_path(self.node_modules_path.slice());
            self.node_modules_path.set_length(node_modules_path_save);

            result = sys::symlink_running_executable(rel_target, abs_dest);
        }

        let Err(err) = result else {
            return Ok(());
        };
        let errno = err.get_errno();
        if !matches!(
            errno,
            sys::Errno::EEXIST | sys::Errno::EPERM | sys::Errno::EACCES | sys::Errno::EOPNOTSUPP
        ) {
            return Err(err.into());
        }

        // Either the name is taken or the directory is read-only. Look at what's there to find out.
        let mut existing = path::path_buffer_pool::get();
        match sys::readlink(abs_dest, existing.as_mut_slice()) {
            Ok(len) if existing[..len] == *rel_target.as_bytes() => return Ok(()),
            Ok(len) => {
                // The global bin directory also has files that Bun didn't put there, such as `bun`
                // itself.
                if global
                    && !Self::link_leads_into(
                        abs_dest,
                        &existing[..len],
                        self.node_modules_path.slice(),
                    )
                {
                    return Err(Error::Sys(bun_errno::SystemErrno::EEXIST));
                }
                let _ = sys::unlink(abs_dest);
            }
            Err(readlink_err) => match readlink_err.get_errno() {
                // A file or a directory.
                sys::Errno::EINVAL if global => {
                    return Err(Error::Sys(bun_errno::SystemErrno::EEXIST));
                }
                // pnpm writes its commands as files, so a file is replaced. `unlink` fails on a directory.
                sys::Errno::EINVAL
                    if Self::is_behind_link(&mut self.is_behind_link, self.node_modules_path) =>
                {
                    // If an existing entry isn't the problem, linking would just fail again.
                    if errno != sys::Errno::EEXIST {
                        return Err(err.into());
                    }
                    if sys::unlink(abs_dest).is_err() {
                        return Err(Error::Sys(bun_errno::SystemErrno::EEXIST));
                    }
                }
                sys::Errno::EINVAL => {
                    let _ = sys::delete_tree_absolute(abs_dest.as_bytes());
                }
                // Removed in the meantime.
                sys::Errno::ENOENT if errno == sys::Errno::EEXIST => {}
                // The name is free and the directory is writable, so this file system doesn't
                // support symlinks (e.g. Android's shared storage).
                sys::Errno::ENOENT
                    if !global
                        && sys::access(
                            resolve_path::z(abs_dest_dir, &mut *existing),
                            sys::posix::W_OK,
                        )
                        .is_ok() =>
                {
                    bun_core::run_once! {{
                        bun_core::warn!(
                            "{}: cannot create symlinks in {}, skipping bin links",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(abs_dest_dir),
                        );
                        bun_core::Output::flush();
                    }}
                    return Ok(());
                }
                _ => return Err(err.into()),
            },
        }

        Ok(sys::symlink_running_executable(rel_target, abs_dest)?)
    }

    #[cfg(not(windows))]
    fn resolved_target_parent_escapes_package_dir(&self, abs_target: &ZStr) -> bool {
        // SAFETY: `target_node_modules_path` is set at construction to either
        // a caller-owned `AbsPath` or the same buffer as `node_modules_path`;
        // both outlive `self` and are not mutated for the duration of this
        // read.
        let dest_dir_without_trailing_slash =
            strings::without_trailing_slash(unsafe { (*self.target_node_modules_path).slice() });
        let package_name = self.target_package_name.slice();

        let mut package_dir_buf = path::path_buffer_pool::get();
        let buf = package_dir_buf.as_mut_slice();
        if dest_dir_without_trailing_slash.len() + package_name.len() + 2 > buf.len() {
            return true;
        }
        let mut off: usize = 0;
        buf[off..off + dest_dir_without_trailing_slash.len()]
            .copy_from_slice(dest_dir_without_trailing_slash);
        off += dest_dir_without_trailing_slash.len();
        buf[off] = SEP;
        off += 1;
        buf[off..off + package_name.len()].copy_from_slice(package_name);
        off += package_name.len();
        buf[off] = 0;
        let package_dir = ZStr::from_buf(&buf[..], off);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            if let Some(escapes) = Self::target_escapes_beneath_package_dir(package_dir, abs_target)
            {
                return escapes;
            }
        }

        let mut real_package_dir_buf = path::path_buffer_pool::get();
        let real_package_dir = match sys::realpath(package_dir, &mut *real_package_dir_buf) {
            Ok(resolved) => resolved,
            Err(_) => return true,
        };

        let target_parent = resolve_path::dirname::<PlatformAuto>(abs_target.as_bytes());
        if target_parent.is_empty() || target_parent.len() >= MAX_PATH_BYTES {
            return true;
        }
        let mut target_parent_buf = path::path_buffer_pool::get();
        let target_parent_z = resolve_path::z(target_parent, &mut *target_parent_buf);
        let mut real_parent_buf = path::path_buffer_pool::get();
        let real_parent = match sys::realpath(target_parent_z, &mut *real_parent_buf) {
            Ok(resolved) => resolved,
            Err(_) => return true,
        };

        matches!(
            resolve_path::is_parent_or_equal(real_package_dir, real_parent),
            resolve_path::ParentEqual::Unrelated
        )
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn target_escapes_beneath_package_dir(package_dir: &ZStr, abs_target: &ZStr) -> Option<bool> {
        let package_dir_bytes = package_dir.as_bytes();
        let abs_target_bytes = abs_target.as_bytes();
        if abs_target_bytes.len() <= package_dir_bytes.len() + 1
            || !strings::starts_with(abs_target_bytes, package_dir_bytes)
            || abs_target_bytes[package_dir_bytes.len()] != SEP
        {
            return None;
        }
        let rel = &abs_target_bytes[package_dir_bytes.len() + 1..];
        if rel.len() >= MAX_PATH_BYTES {
            return None;
        }
        let rel_parent = resolve_path::dirname::<PlatformAuto>(rel);
        if rel_parent.is_empty() {
            return Some(false);
        }
        let package_dir_fd = match sys::open_dir_absolute(package_dir_bytes) {
            Ok(fd) => fd,
            Err(_) => return Some(true),
        };
        let mut rel_buf = path::path_buffer_pool::get();
        let rel_z = resolve_path::z(rel_parent, &mut *rel_buf);
        let opened = sys::openat2_beneath(package_dir_fd, rel_z, sys::O::PATH | sys::O::CLOEXEC, 0);
        let _ = sys::close(package_dir_fd);
        match opened {
            Ok(fd) => {
                let _ = sys::close(fd);
                Some(false)
            }
            Err(err) => match err.get_errno() {
                sys::Errno::ENOSYS
                | sys::Errno::EPERM
                | sys::Errno::EAGAIN
                | sys::Errno::EINVAL => None,
                _ => Some(true),
            },
        }
    }

    /// True when the native binlink optimization has redirected the link
    /// target into a different package than the one that declared the
    /// `bin` field (e.g. `@anthropic-ai/claude-code` -> `@anthropic-ai/claude-code-linux-x64`).
    fn is_native_binlink_redirect(&self) -> bool {
        !strings::eql(self.target_package_name.slice(), self.package_name.slice())
    }

    /// Resolve the absolute target for a bin entry inside `package_dir`.
    ///
    /// When redirected into a platform-specific optional dependency (native
    /// binlink optimization), the platform package may lay the binary out
    /// differently than the root package's `bin` field expects. esbuild
    /// mirrors the path exactly (`bin/esbuild` in both) but other packages
    /// ship the binary at the package root under the bin name (e.g.
    /// `@anthropic-ai/claude-code` has `bin/claude.exe` in the root package
    /// but `claude` at the root of `@anthropic-ai/claude-code-linux-x64`,
    /// which has no `bin` field of its own).
    ///
    /// All candidates come from the root package's `bin` entry - its
    /// value (`target`) and its key (`bin_name`):
    ///   1. `<package_dir>/<target>` - the path from the root `bin` field
    ///   2. `<package_dir>/<bin_name>` - the bin name at package root
    ///   3. `<package_dir>/<basename(target)>` - the target's filename at
    ///      package root (`@anthropic-ai/claude-code-win32-x64` ships
    ///      `claude.exe` at root while the root package's `bin` is
    ///      `bin/claude.exe`)
    ///   4. `<package_dir>/<bin_name>.exe` - esbuild ships `esbuild.exe` at
    ///      the root of `@esbuild/win32-x64` while the root package's `bin`
    ///      is the extensionless `bin/esbuild`. Not `#[cfg(windows)]`-gated
    ///      so the redirect still resolves when cross-installing with
    ///      `--os win32`.
    ///
    /// Falls through to (1) when nothing exists so the existing
    /// `skipped_due_to_missing_bin` retry-without-redirect path still fires.
    /// `None`: the path does not fit `buf`; callers treat that as a missing bin.
    fn resolve_bin_target<'b>(
        is_native_binlink_redirect: bool,
        package_dir: &[u8],
        target: &[u8],
        bin_name: &[u8],
        buf: &'b mut [u8],
    ) -> Option<&'b ZStr> {
        // A trailing separator would make `lchmod` follow a symlinked target; npm drops it too.
        let target = strings::without_trailing_slash(target);

        if !is_native_binlink_redirect {
            return join_z_checked::<PlatformAuto>(package_dir, buf, &[target]);
        }

        let target_basename = path::basename(target);
        let in_subdir = target_basename.len() != target.len();
        let exe_name: Vec<u8> =
            if !bin_name.is_empty() && !strings::has_suffix_comptime(bin_name, b".exe") {
                [bin_name, b".exe"].concat()
            } else {
                Vec::new()
            };
        let at_root = if in_subdir { target_basename } else { b"" };
        for candidate in [target, bin_name, at_root, &exe_name] {
            if candidate.is_empty() {
                continue;
            }
            let found = join_z_checked::<PlatformAuto>(package_dir, buf, &[candidate])
                .filter(|abs| sys::exists_z(abs));
            if let Some(len) = found.map(ZStr::len) {
                return Some(ZStr::from_buf(buf, len));
            }
        }

        // Nothing found; return the primary so `link_bin_or_create_shim` sets
        // `skipped_due_to_missing_bin` and the caller retries without the
        // redirect.
        join_z_checked::<PlatformAuto>(package_dir, buf, &[target])
    }

    /// Length of `<node_modules>/<package>/` in `abs_target_buf`, `None` if a NUL no longer fits.
    pub(crate) fn build_target_package_dir(&mut self) -> Option<usize> {
        // SAFETY: `target_node_modules_path` is set at construction to either
        // a caller-owned `AbsPath` or the same buffer as `node_modules_path`;
        // both outlive `self` and are not mutated for the duration of this
        // read.
        let dest_dir_without_trailing_slash =
            strings::without_trailing_slash(unsafe { (*self.target_node_modules_path).slice() });
        let package_name = self.target_package_name.slice();

        let buf = &mut *self.abs_target_buf;
        if dest_dir_without_trailing_slash.len() + 1 + package_name.len() + 1 >= buf.len() {
            return None;
        }

        // reshaped for borrowck — track offset instead of remain.ptr arithmetic
        let mut off: usize = 0;

        buf[off..off + dest_dir_without_trailing_slash.len()]
            .copy_from_slice(dest_dir_without_trailing_slash);
        off += dest_dir_without_trailing_slash.len();
        buf[off] = SEP;
        off += 1;

        buf[off..off + package_name.len()].copy_from_slice(package_name);
        off += package_name.len();
        buf[off] = SEP;
        off += 1;

        Some(off)
    }

    /// Length of the `.bin/` (or global bin) dir in `abs_dest_buf`, `None` if a NUL no longer fits.
    pub(crate) fn build_destination_dir(&mut self, global: bool) -> Option<usize> {
        let dest_dir_without_trailing_slash = if global {
            strings::without_trailing_slash(self.global_bin_path.as_bytes())
        } else {
            strings::without_trailing_slash(self.node_modules_path.slice())
        };
        let suffix_len = if global { b"/".len() } else { b"/.bin/".len() };

        let buf = &mut *self.abs_dest_buf;
        if dest_dir_without_trailing_slash.len() + suffix_len >= buf.len() {
            return None;
        }

        let mut off: usize = 0;
        buf[off..off + dest_dir_without_trailing_slash.len()]
            .copy_from_slice(dest_dir_without_trailing_slash);
        off += dest_dir_without_trailing_slash.len();
        buf[off] = SEP;
        off += 1;
        if !global {
            buf[off..off + b".bin".len()].copy_from_slice(b".bin");
            off += b".bin".len();
            buf[off] = SEP;
            off += 1;
        }

        Some(off)
    }

    /// `abs_dest_buf` starts with the `dir_len` bytes of the bin directory. If the name doesn't
    /// fit, sets `err` and returns `None`.
    fn append_dest<'b>(&mut self, dir_len: usize, name: &[u8]) -> Option<&'b ZStr> {
        let len = dir_len + name.len();
        if len >= self.abs_dest_buf.len() {
            self.err = Some(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
            return None;
        }
        self.abs_dest_buf[dir_len..len].copy_from_slice(name);
        self.abs_dest_buf[len] = 0;
        // SAFETY: the NUL was written above. Detached from `self` for `link_bin_or_create_shim`,
        // which never touches `abs_dest_buf`; callers are done with it before the next call.
        Some(unsafe { ZStr::from_raw(self.abs_dest_buf.as_ptr(), len) })
    }

    // target: what the symlink points to
    // destination: where the symlink exists on disk
    pub fn link(&mut self, global: bool) {
        let (Some(package_dir_len), Some(dest_dir_len)) = (
            self.build_target_package_dir(),
            self.build_destination_dir(global),
        ) else {
            self.err = Some(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
            return;
        };
        let is_redirect = self.is_native_binlink_redirect();
        let (bin, string_buf, extern_string_buf) =
            (self.bin, self.string_buf, self.extern_string_buf);

        debug_assert!(bin.tag != Tag::None);

        // `abs_target_buf` holds `package_dir`, the join input, so the output needs its own buffer.
        let mut resolved_target_pool_buf = path::path_buffer_pool::get();
        let resolved_target_buf = resolved_target_pool_buf.as_mut_slice();

        // Returns false if the name doesn't fit.
        let mut link_named = |this: &mut Self, name: &[u8], target: &[u8]| -> bool {
            if name.is_empty() || target.is_empty() || bin_target_escapes_package_dir(target) {
                return true;
            }
            let Some(abs_dest) = this.append_dest(dest_dir_len, name) else {
                return false;
            };
            let Some(abs_target) = Self::resolve_bin_target(
                is_redirect,
                &this.abs_target_buf[0..package_dir_len],
                target,
                name,
                resolved_target_buf,
            ) else {
                this.skipped_due_to_missing_bin = true;
                return true;
            };
            this.link_bin_or_create_shim(
                abs_target,
                abs_dest,
                global,
                bin_target_needs_resolved_containment_check(target),
            );
            true
        };

        match bin.tag {
            Tag::None => {}
            Tag::File => {
                let package_name = self.package_name;
                let name = Dependency::unscoped_package_name(package_name.slice());
                link_named(self, name, bin.file().slice(string_buf));
            }
            Tag::NamedFile => {
                let [name, target] = bin.named_file();
                let name = normalized_bin_name(name.slice(string_buf));
                link_named(self, name, target.slice(string_buf));
            }
            Tag::Map => {
                for i in (bin.map().begin()..bin.map().end()).step_by(2) {
                    let name = normalized_bin_name(extern_string_buf[i as usize].slice(string_buf));
                    let target = extern_string_buf[(i + 1) as usize].slice(string_buf);
                    if !link_named(self, name, target) {
                        return;
                    }
                }
            }
            Tag::Dir => {
                let target = bin.dir().slice(string_buf);
                if target.is_empty() || bin_target_escapes_package_dir(target) {
                    return;
                }
                let Some(abs_target_dir) = join_z_checked::<PlatformAuto>(
                    &self.abs_target_buf[0..package_dir_len],
                    resolved_target_buf,
                    &[target],
                ) else {
                    self.err = Some(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                    return;
                };

                let target_dir = match sys::open_dir_absolute(abs_target_dir.as_bytes()) {
                    Ok(d) => sys::Dir::from_fd(d),
                    // https://github.com/npm/cli/blob/366c07e2f3cb9d1c6ddbd03e624a4d73fbd2676e/node_modules/bin-links/lib/link-gently.js#L43
                    Err(err) if err.get_errno() == sys::Errno::ENOENT => {
                        self.skipped_due_to_missing_bin = true;
                        return;
                    }
                    Err(err) => {
                        self.err = Some(err.into());
                        return;
                    }
                };

                let mut abs_target_buf = path::path_buffer_pool::get();
                let mut iter = sys::iterate_dir(target_dir.fd());
                while let Some(entry) = iter.next().unwrap_or(None) {
                    if !matches!(entry.kind, sys::EntryKind::SymLink | sys::EntryKind::File) {
                        continue;
                    }
                    let entry_name = entry.name.slice_u8();
                    let Some(abs_target) = join_z_checked::<PlatformAuto>(
                        abs_target_dir.as_bytes(),
                        abs_target_buf.as_mut_slice(),
                        &[entry_name],
                    ) else {
                        self.skipped_due_to_missing_bin = true;
                        continue;
                    };
                    let Some(abs_dest) = self.append_dest(dest_dir_len, entry_name) else {
                        return;
                    };
                    self.link_bin_or_create_shim(abs_target, abs_dest, global, true);
                }
            }
        }
    }

    pub fn unlink(&mut self, global: bool) {
        let (Some(package_dir_len), Some(dest_dir_len)) = (
            self.build_target_package_dir(),
            self.build_destination_dir(global),
        ) else {
            self.err = Some(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
            return;
        };
        let (bin, string_buf, extern_string_buf) =
            (self.bin, self.string_buf, self.extern_string_buf);

        debug_assert!(bin.tag != Tag::None);

        // Returns false if the name doesn't fit.
        let unlink_name = |this: &mut Self, name: &[u8]| -> bool {
            let Some(abs_dest) = this.append_dest(dest_dir_len, name) else {
                return false;
            };
            let package_dir = &this.abs_target_buf[0..package_dir_len];
            Self::unlink_bin_or_shim(abs_dest, global.then_some(package_dir));
            true
        };

        match bin.tag {
            Tag::None => {}
            Tag::File => {
                let package_name = self.package_name;
                unlink_name(
                    self,
                    Dependency::unscoped_package_name(package_name.slice()),
                );
            }
            Tag::NamedFile => {
                let name = normalized_bin_name(bin.named_file()[0].slice(string_buf));
                if !name.is_empty() {
                    unlink_name(self, name);
                }
            }
            Tag::Map => {
                for i in (bin.map().begin()..bin.map().end()).step_by(2) {
                    let name = normalized_bin_name(extern_string_buf[i as usize].slice(string_buf));
                    if !name.is_empty() && !unlink_name(self, name) {
                        return;
                    }
                }
            }
            Tag::Dir => {
                let target = bin.dir().slice(string_buf);
                if target.is_empty() {
                    return;
                }

                let mut abs_target_dir_buf = path::path_buffer_pool::get();
                let Some(abs_target_dir) = join_z_checked::<PlatformAuto>(
                    &self.abs_target_buf[0..package_dir_len],
                    abs_target_dir_buf.as_mut_slice(),
                    &[target],
                ) else {
                    self.err = Some(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG));
                    return;
                };

                let target_dir = match sys::open_dir_absolute(abs_target_dir.as_bytes()) {
                    Ok(d) => sys::Dir::from_fd(d),
                    Err(err) => {
                        self.err = Some(err.into());
                        return;
                    }
                };

                let mut iter = sys::iterate_dir(target_dir.fd());
                while let Some(entry) = iter.next().unwrap_or(None) {
                    if matches!(entry.kind, sys::EntryKind::SymLink | sys::EntryKind::File)
                        && !unlink_name(self, entry.name.slice_u8())
                    {
                        return;
                    }
                }
            }
        }
    }
}

/// The installers only link the bins of packages that the command names or installs. This links
/// the bins of the remaining global packages, skipping any name that is already taken.
pub(crate) fn link_free_global_bins(lockfile: &Lockfile, global_bin_path: &ZStr) {
    let pkgs = lockfile.packages.slice();
    let (Some(dependencies), Some(resolutions)) = (
        pkgs.items_dependencies().first(),
        pkgs.items_resolutions().first(),
    ) else {
        return;
    };
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let dependencies = dependencies.get(lockfile.buffers.dependencies.as_slice());
    let resolutions = resolutions.get(lockfile.buffers.resolutions.as_slice());
    let placed: Vec<(&[u8], crate::PackageID)> = (dependencies.iter().zip(resolutions))
        .map(|(dependency, &package_id)| (dependency.name.slice(string_buf), package_id))
        .collect();
    link_free_bins(lockfile, b"node_modules", Some(global_bin_path), &placed);
}

/// Adds every entry of the `bin_path` folder to `seen`. The linker skips destinations in `seen`,
/// so it leaves those entries untouched.
fn see_names_in(bin_path: &[u8], seen: &mut StringHashMap<()>) -> sys::Maybe<()> {
    let bin_path = strings::without_trailing_slash(bin_path);
    let bin_dir = sys::Dir::open(bin_path)?;
    let mut iter = sys::iterate_dir(bin_dir.fd());
    while let Some(entry) = iter.next().unwrap_or(None) {
        let name = entry.name.slice_u8();
        #[cfg(windows)]
        let name = (name.strip_suffix(b".bunx"))
            .or_else(|| name.strip_suffix(b".exe"))
            .unwrap_or(name);
        let _ = seen.put(&[bin_path, &[SEP][..], name].concat(), ());
    }
    Ok(())
}

/// Calls `see_names_in` on the `.bin` folder of `node_modules`. A missing `.bin` adds nothing.
pub(crate) fn see_linked_names(node_modules: &[u8], seen: &mut StringHashMap<()>) {
    let node_modules = strings::without_trailing_slash(node_modules);
    let _ = see_names_in(&[node_modules, &[SEP][..], &b".bin"[..]].concat(), seen);
}

/// Links the bins of the packages in `placed`, in order, skipping names that are already taken.
/// `placed` pairs each package with its folder name in `node_modules`.
pub(crate) fn link_free_bins(
    lockfile: &Lockfile,
    node_modules: &[u8],
    global_bin_path: Option<&ZStr>,
    placed: &[(&[u8], crate::PackageID)],
) {
    // Two copies of the same path, because the linker reads `target_node_modules_path` while it
    // holds `node_modules_path` by `&mut`.
    let abs_node_modules = || -> Option<AbsPath> {
        let mut dir = AbsPath::init_top_level_dir();
        dir.try_append(node_modules).ok()?;
        Some(dir)
    };
    let (Some(target_node_modules_path), Some(mut node_modules_path)) =
        (abs_node_modules(), abs_node_modules())
    else {
        return;
    };

    let mut seen: StringHashMap<()> = StringHashMap::default();
    match global_bin_path {
        // The linker creates a missing `.bin`, but never a missing global bin folder.
        Some(bin_path) if see_names_in(bin_path.as_bytes(), &mut seen).is_err() => return,
        Some(_) => {}
        None => see_linked_names(node_modules_path.slice(), &mut seen),
    }

    let mut abs_target_buf = path::path_buffer_pool::get();
    let mut abs_dest_buf = path::path_buffer_pool::get();
    let mut rel_buf = path::path_buffer_pool::get();
    for &(folder, package_id) in placed {
        let Some(&bin) = lockfile.packages.items_bin().get(package_id as usize) else {
            continue;
        };
        if bin.tag == Tag::None {
            continue;
        }
        let package_name = strings::StringOrTinyString::init(folder);
        Linker {
            bin,
            target_node_modules_path: &raw const target_node_modules_path,
            target_package_name: package_name,
            seen: Some(&mut seen),
            node_modules_path: &mut node_modules_path,
            package_name,
            global_bin_path: global_bin_path.unwrap_or(ZStr::EMPTY),
            string_buf: lockfile.buffers.string_bytes.as_slice(),
            extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
            abs_target_buf: abs_target_buf.as_mut_slice(),
            abs_dest_buf: abs_dest_buf.as_mut_slice(),
            rel_buf: rel_buf.as_mut_slice(),
            is_behind_link: Some(false),
            err: None,
            skipped_due_to_missing_bin: false,
        }
        .link(global_bin_path.is_some());
    }
}
