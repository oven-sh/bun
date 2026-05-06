use core::fmt;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_alloc::AllocError;
use bun_collections::StringHashMap;
use bun_core::Error;
use bun_paths::{self as path, AbsPath, PathBuffer, WPathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
use bun_semver::{ExternalString, String};
use bun_str::{strings, w, ZStr};
use bun_sys::{self as sys, Fd, Mode};

use crate::dependency::Dependency;
use crate::install::{self as Install, DependencyID, ExternalStringList};
use crate::windows_shim::BinLinkingShim as WinBinLinkingShim;

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
    _padding_tag: [u8; 3],

    // Largest member must be zero initialized
    pub value: Value,
}

impl Default for Bin {
    fn default() -> Self {
        Bin {
            tag: Tag::None,
            _padding_tag: [0; 3],
            value: Value { map: ExternalStringList::default() },
        }
    }
}

impl Bin {
    pub fn count<B: StringBuilder>(
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

    pub fn eql(
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
                Tag::File => l.value.file.eql(&r.value.file, l_buf, r_buf),
                Tag::Dir => l.value.dir.eql(&r.value.dir, l_buf, r_buf),
                Tag::NamedFile => {
                    l.value.named_file[0].eql(&r.value.named_file[0], l_buf, r_buf)
                        && l.value.named_file[1].eql(&r.value.named_file[1], l_buf, r_buf)
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

    pub fn clone<B: StringBuilder>(
        &self,
        buf: &[u8],
        prev_external_strings: &[ExternalString],
        all_extern_strings: &[ExternalString],
        extern_strings_slice: &mut [ExternalString],
        builder: &mut B,
    ) -> Bin {
        // SAFETY: tag determines the active union field
        unsafe {
            match self.tag {
                Tag::None => Bin {
                    tag: Tag::None,
                    _padding_tag: [0; 3],
                    value: Value::init_none(),
                },
                Tag::File => Bin {
                    tag: Tag::File,
                    _padding_tag: [0; 3],
                    value: Value::init_file(builder.append_string(self.value.file.slice(buf))),
                },
                Tag::NamedFile => Bin {
                    tag: Tag::NamedFile,
                    _padding_tag: [0; 3],
                    value: Value::init_named_file([
                        builder.append_string(self.value.named_file[0].slice(buf)),
                        builder.append_string(self.value.named_file[1].slice(buf)),
                    ]),
                },
                Tag::Dir => Bin {
                    tag: Tag::Dir,
                    _padding_tag: [0; 3],
                    value: Value::init_dir(builder.append_string(self.value.dir.slice(buf))),
                },
                Tag::Map => {
                    for (i, extern_string) in
                        self.value.map.get(prev_external_strings).iter().enumerate()
                    {
                        extern_strings_slice[i] =
                            builder.append_external_string(extern_string.slice(buf));
                    }

                    Bin {
                        tag: Tag::Map,
                        _padding_tag: [0; 3],
                        value: Value::init_map(ExternalStringList::init(
                            all_extern_strings,
                            extern_strings_slice,
                        )),
                    }
                }
            }
        }
    }

    /// Used for packages read from text lockfile.
    pub fn parse_append(
        bin_expr: bun_json::Expr,
        buf: &mut bun_semver::string::Buf,
        extern_strings: &mut Vec<ExternalString>,
    ) -> Result<Bin, AllocError> {
        match bin_expr.data {
            bun_json::ExprData::EObject(obj) => match obj.properties.len() {
                0 => {}
                1 => {
                    let Some(bin_name) = obj.properties.ptr()[0].key.as_ref().unwrap().as_string()
                    else {
                        return Ok(Bin::default());
                    };
                    let Some(value) = obj.properties.ptr()[0].value.as_ref().unwrap().as_string()
                    else {
                        return Ok(Bin::default());
                    };

                    return Ok(Bin {
                        tag: Tag::NamedFile,
                        _padding_tag: [0; 3],
                        value: Value {
                            named_file: [buf.append(bin_name)?, buf.append(value)?],
                        },
                    });
                }
                _ => {
                    let current_len = extern_strings.len();
                    let num_props: usize = obj.properties.len() * 2;
                    extern_strings
                        .reserve_exact((current_len + num_props).saturating_sub(extern_strings.len()));
                    // PORT NOTE: reshaped for borrowck — Zig wrote into the spare-capacity
                    // region by raw pointer; here we push into the Vec.
                    let mut i: usize = 0;
                    for bin_prop in obj.properties.slice() {
                        let key = bin_prop.key.as_ref().unwrap();
                        let value = bin_prop.value.as_ref().unwrap();
                        let Some(key_str) = key.as_string() else {
                            return Ok(Bin::default());
                        };
                        let Some(value_str) = value.as_string() else {
                            return Ok(Bin::default());
                        };
                        extern_strings.push(buf.append_external(key_str)?);
                        i += 1;
                        extern_strings.push(buf.append_external(value_str)?);
                        i += 1;
                    }
                    if cfg!(debug_assertions) {
                        debug_assert!(i == num_props);
                    }
                    let new = &extern_strings[current_len..current_len + num_props];
                    return Ok(Bin {
                        tag: Tag::Map,
                        _padding_tag: [0; 3],
                        value: Value {
                            map: ExternalStringList::init(extern_strings.as_slice(), new),
                        },
                    });
                }
            },
            bun_json::ExprData::EString(str_) => {
                if !str_.data.is_empty() {
                    return Ok(Bin {
                        tag: Tag::File,
                        _padding_tag: [0; 3],
                        value: Value {
                            file: buf.append(str_.data)?,
                        },
                    });
                }
            }
            _ => {}
        }
        Ok(Bin::default())
    }

    pub fn parse_append_from_directories(
        bin_expr: bun_json::Expr,
        buf: &mut bun_semver::string::Buf,
    ) -> Result<Bin, AllocError> {
        if let Some(bin_str) = bin_expr.as_string() {
            return Ok(Bin {
                tag: Tag::Dir,
                _padding_tag: [0; 3],
                value: Value {
                    dir: buf.append(bin_str)?,
                },
            });
        }
        Ok(Bin::default())
    }

    pub fn to_json<W: fmt::Write, const STYLE: ToJsonStyle>(
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
                        write!(writer, "{}", self.value.file.fmt_json(buf, Default::default()))?;
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
                        write!(writer, "{}", self.value.dir.fmt_json(buf, Default::default()))?;
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
                    write!(writer, "{}", self.value.file.fmt_json(buf, Default::default()))?;
                }
                Tag::NamedFile => {
                    writer.write_str("{\n")?;
                    *indent += 1;
                    write_indent(writer, indent)?;
                    write!(
                        writer,
                        "{}: {},\n",
                        self.value.named_file[0].fmt_json(buf, Default::default()),
                        self.value.named_file[1].fmt_json(buf, Default::default()),
                    )?;
                    *indent -= 1;
                    write_indent(writer, indent)?;
                    writer.write_char('}')?;
                }
                Tag::Dir => {
                    write!(writer, "{}", self.value.dir.fmt_json(buf, Default::default()))?;
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
                        write!(
                            writer,
                            "{}: {},\n",
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

    pub fn init() -> Bin {
        // TODO(port): bun.serializable() zero-initialized padding for hashing stability
        Bin {
            tag: Tag::None,
            _padding_tag: [0; 3],
            value: Value::init_none(),
        }
    }
}

#[derive(core::marker::ConstParamTy, PartialEq, Eq)]
pub enum ToJsonStyle {
    SingleLine,
    MultiLine,
}

// TODO(port): this trait stands in for the `comptime StringBuilder: type` param
// used by `count`/`clone`. Phase B should map it to the real StringBuilder type(s).
pub trait StringBuilder {
    fn count(&mut self, s: &[u8]);
    fn append_string(&mut self, s: &[u8]) -> String;
    fn append_external_string(&mut self, s: &[u8]) -> ExternalString;
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union Value {
    /// no "bin", or empty "bin"
    pub none: (),

    /// "bin" is a string
    /// ```
    /// "bin": "./bin/foo",
    /// ```
    pub file: String,

    // Single-entry map
    ///```
    /// "bin": {
    ///     "babel": "./cli.js",
    /// }
    ///```
    pub named_file: [String; 2],

    /// "bin" is a directory
    ///```
    /// "dirs": {
    ///     "bin": "./bin",
    /// }
    ///```
    pub dir: String,
    // "bin" is a map
    ///```
    /// "bin": {
    ///     "babel": "./cli.js",
    ///     "babel-cli": "./cli.js",
    /// }
    ///```
    pub map: ExternalStringList,
}

impl Value {
    /// To avoid undefined memory between union values, we must zero initialize the union first.
    // TODO(port): bun.serializableInto zeroed the full union before assignment.
    #[inline]
    pub fn init_none() -> Value {
        // SAFETY: all-zero is a valid Value (largest member ExternalStringList is POD)
        unsafe { core::mem::zeroed() }
    }
    #[inline]
    pub fn init_file(file: String) -> Value {
        let mut v = Self::init_none();
        v.file = file;
        v
    }
    #[inline]
    pub fn init_named_file(named_file: [String; 2]) -> Value {
        let mut v = Self::init_none();
        v.named_file = named_file;
        v
    }
    #[inline]
    pub fn init_dir(dir: String) -> Value {
        let mut v = Self::init_none();
        v.dir = dir;
        v
    }
    #[inline]
    pub fn init_map(map: ExternalStringList) -> Value {
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
    /// ```
    /// "bin": "./bin/foo",
    /// ```
    File = 1,

    // Single-entry map
    ///```
    /// "bin": {
    ///     "babel": "./cli.js",
    /// }
    ///```
    NamedFile = 2,

    /// "bin" is a directory
    ///```
    /// "dirs": {
    ///     "bin": "./bin",
    /// }
    ///```
    Dir = 3,

    // "bin" is a map of more than one
    ///```
    /// "bin": {
    ///     "babel": "./cli.js",
    ///     "babel-cli": "./cli.js",
    ///     "webpack-dev-server": "./cli.js",
    /// }
    ///```
    Map = 4,
}

pub struct NamesIterator<'a> {
    pub bin: Bin,
    pub i: usize,
    pub done: bool,
    // TODO(port): std.fs.Dir.Iterator → bun_sys directory iterator type
    pub dir_iterator: Option<sys::DirIterator>,
    pub package_name: String,
    // TODO(port): std.fs.Dir → bun_sys::Dir; default was bun.invalid_fd.stdDir()
    pub destination_node_modules: sys::Dir,
    pub buf: PathBuffer,
    pub string_buffer: &'a [u8],
    pub extern_string_buf: &'a [ExternalString],
}

impl<'a> NamesIterator<'a> {
    fn next_in_dir(&mut self) -> Result<Option<&[u8]>, Error> {
        if self.done {
            return Ok(None);
        }
        if self.dir_iterator.is_none() {
            // SAFETY: tag == Dir checked by caller
            let mut target = unsafe { self.bin.value.dir }.slice(self.string_buffer);
            if strings::has_prefix(target, b"./") || strings::has_prefix(target, b".\\") {
                target = &target[2..];
            }
            let parts: [&[u8]; 2] = [self.package_name.slice(self.string_buffer), target];

            let dir = self.destination_node_modules;

            let joined = path::join_string_buf(self.buf.as_mut_slice(), &parts, path::Style::Auto);
            let joined_len = joined.len();
            self.buf[joined_len] = 0;
            // SAFETY: buf[joined_len] == 0 written above
            let joined_ = unsafe { ZStr::from_raw_mut(self.buf.as_mut_ptr(), joined_len) };
            // TODO(port): bun.openDir(dir, path) → bun_sys equivalent
            let child_dir = sys::open_dir(dir, joined_)?;
            self.dir_iterator = Some(child_dir.iterate());
        }

        let iter = self.dir_iterator.as_mut().unwrap();
        if let Some(entry) = iter.next().unwrap_or(None) {
            self.i += 1;
            Ok(Some(entry.name))
        } else {
            self.done = true;
            self.dir_iterator.take().unwrap().dir().close();
            Ok(None)
        }
    }

    /// next filename, e.g. "babel" instead of "cli.js"
    pub fn next(&mut self) -> Result<Option<&[u8]>, Error> {
        match self.bin.tag {
            Tag::File => {
                if self.i > 0 {
                    return Ok(None);
                }
                self.i += 1;
                self.done = true;
                let base = path::basename(self.package_name.slice(self.string_buffer));
                if strings::has_prefix(base, b"./") || strings::has_prefix(base, b".\\") {
                    return Ok(Some(strings::copy(self.buf.as_mut_slice(), &base[2..])));
                }

                Ok(Some(strings::copy(self.buf.as_mut_slice(), base)))
            }
            Tag::NamedFile => {
                if self.i > 0 {
                    return Ok(None);
                }
                self.i += 1;
                self.done = true;
                // SAFETY: tag == NamedFile
                let base =
                    path::basename(unsafe { self.bin.value.named_file }[0].slice(self.string_buffer));
                if strings::has_prefix(base, b"./") || strings::has_prefix(base, b".\\") {
                    return Ok(Some(strings::copy(self.buf.as_mut_slice(), &base[2..])));
                }
                Ok(Some(strings::copy(self.buf.as_mut_slice(), base)))
            }

            Tag::Dir => self.next_in_dir(),
            Tag::Map => {
                // SAFETY: tag == Map
                let map = unsafe { self.bin.value.map };
                if self.i >= map.len as usize {
                    return Ok(None);
                }
                let index = self.i;
                self.i += 2;
                self.done = self.i >= map.len as usize;
                let current_string = map.get(self.extern_string_buf)[index];

                let base = path::basename(current_string.slice(self.string_buffer));
                if strings::has_prefix(base, b"./") || strings::has_prefix(base, b".\\") {
                    return Ok(Some(strings::copy(self.buf.as_mut_slice(), &base[2..])));
                }
                Ok(Some(strings::copy(self.buf.as_mut_slice(), base)))
            }
            _ => Ok(None),
        }
    }
}

pub struct PriorityQueueContext<'a> {
    pub dependencies: &'a Vec<Dependency>,
    pub string_buf: &'a Vec<u8>,
}

impl<'a> PriorityQueueContext<'a> {
    pub fn less_than(&self, a: DependencyID, b: DependencyID) -> core::cmp::Ordering {
        let deps = self.dependencies.as_slice();
        let buf = self.string_buf.as_slice();
        let a_name = deps[a as usize].name.slice(buf);
        let b_name = deps[b as usize].name.slice(buf);
        strings::order(a_name, b_name)
    }
}

// TODO(port): std.PriorityQueue(DependencyID, PriorityQueueContext, lessThan)
pub type PriorityQueue<'a> = bun_collections::PriorityQueue<DependencyID, PriorityQueueContext<'a>>;

// https://github.com/npm/npm-normalize-package-bin/blob/574e6d7cd21b2f3dee28a216ec2053c2551f7af9/lib/index.js#L38
pub fn normalized_bin_name(name: &[u8]) -> &[u8] {
    if let Some(i) = name.iter().rposition(|&b| b == b'/' || b == b'\\' || b == b':') {
        return &name[i + 1..];
    }

    name
}

pub struct Linker<'a> {
    pub bin: Bin,

    /// Usually will be the same as `node_modules_path`.
    /// Used to support native bin linking.
    pub target_node_modules_path: &'a AbsPath,

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

    pub err: Option<Error>,
    pub skipped_due_to_missing_bin: bool,
}

pub static UMASK: AtomicU32 = AtomicU32::new(0);
static HAS_SET_UMASK: AtomicBool = AtomicBool::new(false);

impl<'a> Linker<'a> {
    pub fn ensure_umask() {
        if !HAS_SET_UMASK.load(Ordering::Acquire) {
            HAS_SET_UMASK.store(true, Ordering::Release);
            UMASK.store(sys::umask(0) as u32, Ordering::Release);
        }
    }

    fn unlink_bin_or_shim(abs_dest: &ZStr) {
        #[cfg(not(windows))]
        {
            let _ = sys::unlink(abs_dest);
            return;
        }

        #[cfg(windows)]
        {
            let mut dest_buf = WPathBuffer::uninit();
            let abs_dest_w = strings::convert_utf8_to_utf16_in_buffer(dest_buf.as_mut_slice(), abs_dest.as_bytes());
            let abs_dest_w_len = abs_dest_w.len();
            let bunx_suffix = w!(".bunx\x00");
            dest_buf[abs_dest_w_len..abs_dest_w_len + bunx_suffix.len()].copy_from_slice(bunx_suffix);
            // SAFETY: dest_buf[abs_dest_w_len + ".bunx".len()] == 0 written above
            let abs_bunx_file = unsafe {
                bun_str::WStr::from_raw(dest_buf.as_ptr(), abs_dest_w_len + b".bunx".len())
            };
            let _ = sys::unlink_w(abs_bunx_file);
            let exe_suffix = w!(".exe\x00");
            dest_buf[abs_dest_w_len..abs_dest_w_len + exe_suffix.len()].copy_from_slice(exe_suffix);
            // SAFETY: dest_buf[abs_dest_w_len + ".exe".len()] == 0 written above
            let abs_exe_file = unsafe {
                bun_str::WStr::from_raw(dest_buf.as_ptr(), abs_dest_w_len + b".exe".len())
            };
            let _ = sys::unlink_w(abs_exe_file);
        }
    }

    fn link_bin_or_create_shim(&mut self, abs_target: &ZStr, abs_dest: &ZStr, global: bool) {
        debug_assert!(path::is_absolute(abs_target.as_bytes()));
        debug_assert!(path::is_absolute(abs_dest.as_bytes()));
        debug_assert!(abs_target.as_bytes()[abs_target.as_bytes().len() - 1] != SEP);
        debug_assert!(abs_dest.as_bytes()[abs_dest.as_bytes().len() - 1] != SEP);

        if let Some(seen) = self.seen.as_deref() {
            // Skip seen destinations for this tree
            // https://github.com/npm/cli/blob/22731831e22011e32fa0ca12178e242c2ee2b33d/node_modules/bin-links/lib/link-gently.js#L30
            if seen.contains(abs_dest.as_bytes()) {
                return;
            }
        }

        // Skip if the target does not exist. This is important because placing a dangling
        // shim in path might break a postinstall
        if !sys::exists(abs_target) {
            self.skipped_due_to_missing_bin = true;
            return;
        }

        if let Some(seen) = self.seen.as_deref_mut() {
            let entry = seen.get_or_put(abs_dest.as_bytes());
            if !entry.found_existing {
                *entry.key_ptr = Box::<[u8]>::from(abs_dest.as_bytes());
            }
        }

        bun_core::analytics::Features::binlinks_inc(1);

        #[cfg(not(windows))]
        {
            self.create_symlink(abs_target, abs_dest, global);
        }
        #[cfg(windows)]
        {
            let target = match sys::openat(Fd::cwd(), abs_target, sys::O::RDONLY, 0).unwrap() {
                Ok(fd) => fd,
                Err(err) => {
                    if err != bun_core::err!("EISDIR") {
                        // ignore directories, creating a shim for one won't do anything
                        self.err = Some(err);
                    }
                    return;
                }
            };
            let _close = scopeguard::guard((), |_| target.close());
            self.create_windows_shim(target, abs_target, abs_dest, global);
        }

        if self.err.is_some() {
            // cleanup on error just in case
            Self::unlink_bin_or_shim(abs_dest);
            return;
        }

        #[cfg(not(windows))]
        {
            Self::try_normalize_shebang(abs_target);
        }
    }

    fn try_normalize_shebang(abs_target: &ZStr) {
        let mut shebang_buf = [0u8; 2048];

        // any error here is ignored
        let chunk_len = 'brk: {
            let Ok(bin_for_reading) =
                sys::File::openat(Fd::cwd(), abs_target, sys::O::RDONLY, 0).unwrap()
            else {
                return;
            };
            let _close = scopeguard::guard((), |_| bin_for_reading.close());

            let Ok(read) = bin_for_reading.read_all(&mut shebang_buf).unwrap() else {
                return;
            };
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
        let Ok(tmpname) = bun_fs::FileSystem::tmpname(
            path::basename(abs_target.as_bytes()),
            &mut tmpname_buf,
            bun_wyhash::hash(chunk_without_newline),
        ) else {
            return;
        };

        let Some(dir_path) = path::dirname(abs_target.as_bytes(), path::Style::Auto) else {
            return;
        };

        let (content, content_to_free): (&[u8], Box<[u8]>) = 'brk: {
            if chunk.len() >= shebang_buf.len() {
                // Partial read. Need to read the rest of the file.
                let original_contents = match sys::File::read_from(Fd::cwd(), abs_target) {
                    sys::Result::Ok(contents) => contents,
                    sys::Result::Err(_) => return,
                };
                // PORT NOTE: reshaped for borrowck — content borrows the boxed slice we own
                // TODO(port): the Zig aliased the same buffer; here we duplicate the reference
                break 'brk (
                    // SAFETY: content_to_free outlives content within this fn body
                    unsafe { core::slice::from_raw_parts(original_contents.as_ptr(), original_contents.len()) },
                    original_contents,
                );
            }

            break 'brk (chunk, Box::default());
        };
        let _ = &content_to_free; // freed on drop

        // Get original file permissions to preserve them (including setuid/setgid/sticky bits)
        let Ok(original_stat) = sys::fstatat(Fd::cwd(), abs_target).unwrap() else {
            return;
        };
        let original_mode: Mode = Mode::try_from(original_stat.mode).unwrap();

        // Create temporary file path
        let mut tmppath_buf = [0u8; MAX_PATH_BYTES];
        let tmppath =
            path::join_abs_string_buf_z(dir_path, &mut tmppath_buf, &[tmpname], path::Style::Auto);
        let mut needs_unlink = true;
        let unlink_guard = scopeguard::guard(&mut needs_unlink, |needs_unlink| {
            if *needs_unlink {
                let _ = sys::unlinkat(Fd::cwd(), tmppath);
            }
        });

        // Write to temporary file with corrected content
        {
            let Ok(tmpfile) = sys::File::openat(
                Fd::cwd(),
                tmppath,
                sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                original_mode,
            )
            .unwrap() else {
                return;
            };
            let _close = scopeguard::guard((), |_| tmpfile.close());

            // Write the corrected shebang (without \r)
            if tmpfile
                .write_all(&chunk_without_newline[0..chunk_without_newline.len() - 1])
                .unwrap()
                .is_err()
            {
                return;
            }
            if tmpfile.write_all(b"\n").unwrap().is_err() {
                return;
            }

            // Write the rest of the file (after the newline)
            if content.len() > newline + 1 {
                if tmpfile.write_all(&content[newline + 1..]).unwrap().is_err() {
                    return;
                }
            }

            // Reapply original permissions (umask was applied during openat, so we need to restore)
            if sys::fchmodat(
                Fd::cwd(),
                tmppath,
                Mode::try_from(original_stat.mode & 0o777).unwrap(),
                0,
            )
            .unwrap()
            .is_err()
            {
                return;
            }
        }

        // Atomic replace: rename temp file to original
        match sys::renameat(Fd::cwd(), tmppath, Fd::cwd(), abs_target) {
            sys::Result::Ok(()) => {
                **scopeguard::ScopeGuard::into_inner(unlink_guard) = false;
            }
            sys::Result::Err(_) => {}
        }
    }

    #[cfg(windows)]
    fn create_windows_shim(
        &mut self,
        target: Fd,
        abs_target: &ZStr,
        abs_dest: &ZStr,
        global: bool,
    ) {
        let mut shim_buf = [0u8; 65536];
        let mut read_in_buf = [0u8; WinBinLinkingShim::Shebang::MAX_SHEBANG_INPUT_LENGTH];
        let mut dest_buf = WPathBuffer::uninit();
        let mut target_buf = WPathBuffer::uninit();

        let abs_dest_w =
            strings::convert_utf8_to_utf16_in_buffer(dest_buf.as_mut_slice(), abs_dest.as_bytes());
        let abs_dest_w_len = abs_dest_w.len();
        let bunx_suffix = w!(".bunx\x00");
        dest_buf[abs_dest_w_len..abs_dest_w_len + bunx_suffix.len()].copy_from_slice(bunx_suffix);

        // SAFETY: dest_buf[abs_dest_w_len + ".bunx".len()] == 0 written above
        let abs_bunx_file = unsafe {
            bun_str::WStr::from_raw(dest_buf.as_ptr(), abs_dest_w_len + b".bunx".len())
        };

        let bunx_file = 'bunx_file: {
            match sys::File::openat_os_path(
                Fd::invalid(),
                abs_bunx_file,
                sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                0o664,
            )
            .unwrap()
            {
                Ok(f) => break 'bunx_file f,
                Err(err) => {
                    if err != bun_core::err!("ENOENT") || global {
                        self.err = Some(err);
                        return;
                    }

                    let node_modules_path_save = self.node_modules_path.save();
                    self.node_modules_path.append(b".bin");
                    // TODO(port): bun.makePath(std.fs.cwd(), ...)
                    let _ = sys::make_path(Fd::cwd(), self.node_modules_path.slice());
                    node_modules_path_save.restore();

                    match sys::File::openat_os_path(
                        Fd::invalid(),
                        abs_bunx_file,
                        sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
                        0o664,
                    )
                    .unwrap()
                    {
                        Ok(f) => break 'bunx_file f,
                        Err(real_err) => {
                            self.err = Some(real_err);
                            return;
                        }
                    }
                }
            }
        };
        let _close = scopeguard::guard((), |_| bunx_file.close());

        let rel_target = path::relative_buf_z(
            self.rel_buf,
            path::dirname(abs_dest.as_bytes(), path::Style::Auto).unwrap_or(b""),
            abs_target.as_bytes(),
        );
        debug_assert!(strings::has_prefix(rel_target.as_bytes(), b"..\\"));

        let rel_target_w = strings::to_w_path_normalized(
            target_buf.as_mut_slice(),
            &rel_target.as_bytes()[b"..\\".len()..],
        );

        let shebang = 'shebang: {
            let first_content_chunk: Option<&[u8]> = 'contents: {
                // TODO(port): target.stdFile().readerStreaming(&.{}) + readVec
                let read = match sys::read(target, &mut read_in_buf) {
                    sys::Result::Ok(n) => n,
                    sys::Result::Err(_) => break 'contents None,
                };
                if read == 0 {
                    break 'contents None;
                }
                break 'contents Some(&read_in_buf[0..read]);
            };

            if let Some(chunk) = first_content_chunk {
                match WinBinLinkingShim::Shebang::parse(chunk, rel_target_w) {
                    Ok(s) => break 'shebang s,
                    Err(_) => {
                        self.err = Some(bun_core::err!("InvalidBinCount"));
                        return;
                    }
                }
            } else {
                break 'shebang WinBinLinkingShim::Shebang::parse_from_bin_path(rel_target_w);
            }
        };

        let shim = WinBinLinkingShim {
            bin_path: rel_target_w,
            shebang,
        };

        let len = shim.encoded_length();
        if len > shim_buf.len() {
            self.err = Some(bun_core::err!("InvalidBinContent"));
            return;
        }

        let metadata = &mut shim_buf[0..len];
        if shim.encode_into(metadata).is_err() {
            self.err = Some(bun_core::err!("InvalidBinContent"));
            return;
        }

        if let Err(err) = bunx_file.writer().write_all(metadata) {
            self.err = Some(err.into());
            return;
        }

        let exe_suffix = w!(".exe\x00");
        dest_buf[abs_dest_w_len..abs_dest_w_len + exe_suffix.len()].copy_from_slice(exe_suffix);
        // SAFETY: dest_buf[abs_dest_w_len + ".exe".len()] == 0 written above
        let abs_exe_file = unsafe {
            bun_str::WStr::from_raw(dest_buf.as_ptr(), abs_dest_w_len + b".exe".len())
        };

        if let Err(err) = sys::File::write_file(
            Fd::invalid(),
            abs_exe_file,
            WinBinLinkingShim::EMBEDDED_EXECUTABLE_DATA,
        )
        .unwrap()
        {
            if err == bun_core::err!("EBUSY") {
                // exe is most likely running. bunx file has already been updated, ignore error
                return;
            }

            self.err = Some(err);
            return;
        }
    }

    #[cfg(not(windows))]
    fn create_symlink(&mut self, abs_target: &ZStr, abs_dest: &ZStr, global: bool) {
        // PORT NOTE: hoisted from `defer { if (this.err == null) chmod }` — scopeguard
        // cannot capture `&mut self.err` without conflicting with the body's writes,
        // so each return path calls `Self::chmod_on_ok` explicitly instead.

        let abs_dest_dir = path::dirname(abs_dest.as_bytes(), path::Style::Auto).unwrap_or(b"");
        let rel_target = path::relative_buf_z(self.rel_buf, abs_dest_dir, abs_target.as_bytes());

        debug_assert!(strings::has_prefix(rel_target.as_bytes(), b".."));

        match sys::symlink_running_executable(rel_target, abs_dest) {
            sys::Result::Err(err) => {
                if err.get_errno() != sys::Errno::EXIST && err.get_errno() != sys::Errno::NOENT {
                    self.err = Some(err.to_zig_err());
                    Self::chmod_on_ok(&self.err, abs_target);
                    return;
                }

                // ENOENT means `.bin` hasn't been created yet. Should only happen if this isn't global
                if err.get_errno() == sys::Errno::NOENT {
                    if global {
                        self.err = Some(err.to_zig_err());
                        Self::chmod_on_ok(&self.err, abs_target);
                        return;
                    }

                    let node_modules_path_save = self.node_modules_path.save();
                    self.node_modules_path.append(b".bin");
                    // TODO(port): bun.makePath(std.fs.cwd(), ...)
                    let _ = sys::make_path(Fd::cwd(), self.node_modules_path.slice());
                    node_modules_path_save.restore();

                    match sys::symlink_running_executable(rel_target, abs_dest) {
                        sys::Result::Err(real_error) => {
                            // It was just created, no need to delete destination and symlink again
                            self.err = Some(real_error.to_zig_err());
                            Self::chmod_on_ok(&self.err, abs_target);
                            return;
                        }
                        sys::Result::Ok(()) => {
                            Self::chmod_on_ok(&self.err, abs_target);
                            return;
                        }
                    }
                    // NOTE: unreachable in Zig too — the third symlink call below the
                    // switch in the original is dead code (both arms above return).
                }

                // beyond this error can only be `.EXIST`
                debug_assert!(err.get_errno() == sys::Errno::EXIST);
            }
            sys::Result::Ok(()) => {
                Self::chmod_on_ok(&self.err, abs_target);
                return;
            }
        }

        // delete and try again
        // TODO(port): std.fs.deleteTreeAbsolute → bun_sys equivalent
        let _ = sys::delete_tree_absolute(abs_dest.as_bytes());
        if let Err(err) = sys::symlink_running_executable(rel_target, abs_dest).unwrap() {
            self.err = Some(err);
        }
        Self::chmod_on_ok(&self.err, abs_target);
    }

    #[cfg(not(windows))]
    fn chmod_on_ok(err: &Option<Error>, abs_target: &ZStr) {
        // PORT NOTE: hoisted from `defer` block in create_symlink
        if err.is_none() {
            let _ = sys::chmod(
                abs_target,
                Mode::try_from(UMASK.load(Ordering::Acquire)).unwrap() | 0o777,
            );
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
    /// Both candidates come from the root package's `bin` entry - its
    /// value (`target`) and its key (`bin_name`):
    ///   1. `<package_dir>/<target>` - the path from the root `bin` field
    ///   2. `<package_dir>/<bin_name>` - the bin name at package root
    ///
    /// Falls through to (1) when nothing exists so the existing
    /// `skipped_due_to_missing_bin` retry-without-redirect path still fires.
    fn resolve_bin_target(&self, package_dir: &[u8], target: &[u8], bin_name: &[u8]) -> &ZStr {
        // TODO(port): path.joinAbsStringZ uses a threadlocal buffer; the returned &ZStr
        // borrows that. Phase B must ensure no re-entry between calls below.
        let primary = path::join_abs_string_z(package_dir, &[target], path::Style::Auto);

        if !self.is_native_binlink_redirect() {
            return primary;
        }

        if sys::exists(primary) {
            return primary;
        }

        if !bin_name.is_empty() {
            let at_root = path::join_abs_string_z(package_dir, &[bin_name], path::Style::Auto);
            if sys::exists(at_root) {
                return at_root;
            }
        }

        // Nothing found; return the primary so `linkBinOrCreateShim` sets
        // `skipped_due_to_missing_bin` and the caller retries without the
        // redirect.
        path::join_abs_string_z(package_dir, &[target], path::Style::Auto)
    }

    /// uses `self.abs_target_buf`
    pub fn build_target_package_dir(&mut self) -> &[u8] {
        let dest_dir_without_trailing_slash =
            strings::without_trailing_slash(self.target_node_modules_path.slice());

        // PORT NOTE: reshaped for borrowck — track offset instead of remain.ptr arithmetic
        let mut off: usize = 0;
        let buf = &mut *self.abs_target_buf;

        buf[off..off + dest_dir_without_trailing_slash.len()]
            .copy_from_slice(dest_dir_without_trailing_slash);
        off += dest_dir_without_trailing_slash.len();
        buf[off] = SEP;
        off += 1;

        let package_name = self.target_package_name.slice();
        buf[off..off + package_name.len()].copy_from_slice(package_name);
        off += package_name.len();
        buf[off] = SEP;
        off += 1;

        &self.abs_target_buf[0..off]
    }

    /// Returns the offset into `self.abs_dest_buf` where the destination dir ends
    /// (i.e. where the bin name should be written).
    // PORT NOTE: reshaped — Zig returned a `[]u8` view (remain) into abs_dest_buf;
    // returning an offset avoids overlapping &mut borrows of self.
    pub fn build_destination_dir(&mut self, global: bool) -> usize {
        let dest_dir_without_trailing_slash =
            strings::without_trailing_slash(self.node_modules_path.slice());

        let buf = &mut *self.abs_dest_buf;
        let mut off: usize = 0;
        if global {
            let global_bin_path_without_trailing_slash =
                strings::without_trailing_slash(self.global_bin_path.as_bytes());
            buf[off..off + global_bin_path_without_trailing_slash.len()]
                .copy_from_slice(global_bin_path_without_trailing_slash);
            off += global_bin_path_without_trailing_slash.len();
            buf[off] = SEP;
            off += 1;
        } else {
            buf[off..off + dest_dir_without_trailing_slash.len()]
                .copy_from_slice(dest_dir_without_trailing_slash);
            off += dest_dir_without_trailing_slash.len();
            // sep_str ++ ".bin" ++ sep_str
            buf[off] = SEP;
            buf[off + 1..off + 1 + b".bin".len()].copy_from_slice(b".bin");
            buf[off + 1 + b".bin".len()] = SEP;
            off += b"/.bin/".len();
        }

        off
    }

    // target: what the symlink points to
    // destination: where the symlink exists on disk
    pub fn link(&mut self, global: bool) {
        // PORT NOTE: reshaped for borrowck — copy package_dir into a local
        // since build_target_package_dir borrows abs_target_buf which is later reused.
        let package_dir_len = self.build_target_package_dir().len();
        let mut dest_off = self.build_destination_dir(global);

        debug_assert!(self.bin.tag != Tag::None);

        // SAFETY: tag determines the active union field
        unsafe {
            match self.bin.tag {
                Tag::None => {}
                Tag::File => {
                    let target = self.bin.value.file.slice(self.string_buf);
                    if target.is_empty() {
                        return;
                    }

                    let unscoped_package_name =
                        Dependency::unscoped_package_name(self.package_name.slice());

                    let package_dir = &self.abs_target_buf[0..package_dir_len];
                    // for normalizing `target`
                    let abs_target =
                        self.resolve_bin_target(package_dir, target, unscoped_package_name);

                    self.abs_dest_buf[dest_off..dest_off + unscoped_package_name.len()]
                        .copy_from_slice(unscoped_package_name);
                    dest_off += unscoped_package_name.len();
                    self.abs_dest_buf[dest_off] = 0;
                    let abs_dest_len = dest_off;
                    // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                    let abs_dest = ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                    self.link_bin_or_create_shim(abs_target, abs_dest, global);
                }
                Tag::NamedFile => {
                    let name = self.bin.value.named_file[0].slice(self.string_buf);
                    let normalized_name = normalized_bin_name(name);
                    let target = self.bin.value.named_file[1].slice(self.string_buf);
                    if normalized_name.is_empty() || target.is_empty() {
                        return;
                    }

                    let package_dir = &self.abs_target_buf[0..package_dir_len];
                    // for normalizing `target`
                    let abs_target =
                        self.resolve_bin_target(package_dir, target, normalized_name);

                    self.abs_dest_buf[dest_off..dest_off + normalized_name.len()]
                        .copy_from_slice(normalized_name);
                    dest_off += normalized_name.len();
                    self.abs_dest_buf[dest_off] = 0;
                    let abs_dest_len = dest_off;
                    // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                    let abs_dest = ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                    self.link_bin_or_create_shim(abs_target, abs_dest, global);
                }
                Tag::Map => {
                    let mut i = self.bin.value.map.begin();
                    let end = self.bin.value.map.end();

                    let abs_dest_dir_end = dest_off;

                    while i < end {
                        let bin_dest = self.extern_string_buf[i as usize].slice(self.string_buf);
                        let normalized_bin_dest = normalized_bin_name(bin_dest);
                        let bin_target =
                            self.extern_string_buf[(i + 1) as usize].slice(self.string_buf);
                        if bin_target.is_empty() || normalized_bin_dest.is_empty() {
                            i += 2;
                            continue;
                        }

                        let package_dir = &self.abs_target_buf[0..package_dir_len];
                        let abs_target =
                            self.resolve_bin_target(package_dir, bin_target, normalized_bin_dest);

                        dest_off = abs_dest_dir_end;
                        self.abs_dest_buf[dest_off..dest_off + normalized_bin_dest.len()]
                            .copy_from_slice(normalized_bin_dest);
                        dest_off += normalized_bin_dest.len();
                        self.abs_dest_buf[dest_off] = 0;
                        let abs_dest_len = dest_off;
                        // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                        let abs_dest = ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                        self.link_bin_or_create_shim(abs_target, abs_dest, global);

                        i += 2;
                    }
                }
                Tag::Dir => {
                    let target = self.bin.value.dir.slice(self.string_buf);
                    if target.is_empty() {
                        return;
                    }

                    let package_dir = &self.abs_target_buf[0..package_dir_len];
                    // for normalizing `target`
                    let abs_target_dir =
                        path::join_abs_string_z(package_dir, &[target], path::Style::Auto);

                    let mut target_dir = match sys::open_dir_absolute(abs_target_dir) {
                        Ok(d) => d,
                        Err(err) => {
                            if err == bun_core::err!("ENOENT") {
                                // https://github.com/npm/cli/blob/366c07e2f3cb9d1c6ddbd03e624a4d73fbd2676e/node_modules/bin-links/lib/link-gently.js#L43
                                // avoid erroring when the directory does not exist
                                return;
                            }
                            self.err = Some(err);
                            return;
                        }
                    };
                    let _close = scopeguard::guard((), |_| target_dir.close());

                    let abs_dest_dir_end = dest_off;

                    let mut iter = target_dir.iterate();
                    while let Some(entry) = iter.next().unwrap_or(None) {
                        match entry.kind {
                            sys::DirEntryKind::SymLink | sys::DirEntryKind::File => {
                                // `self.abs_target_buf` is available now because `path::join_abs_string_z` copied everything into `parse_join_input_buffer`
                                let abs_target = path::join_abs_string_buf_z(
                                    abs_target_dir.as_bytes(),
                                    self.abs_target_buf,
                                    &[entry.name],
                                    path::Style::Auto,
                                );

                                dest_off = abs_dest_dir_end;
                                self.abs_dest_buf[dest_off..dest_off + entry.name.len()]
                                    .copy_from_slice(entry.name);
                                dest_off += entry.name.len();
                                self.abs_dest_buf[dest_off] = 0;
                                let abs_dest_len = dest_off;
                                // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                                let abs_dest =
                                    ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                                self.link_bin_or_create_shim(abs_target, abs_dest, global);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    pub fn unlink(&mut self, global: bool) {
        let package_dir_len = self.build_target_package_dir().len();
        let mut dest_off = self.build_destination_dir(global);

        debug_assert!(self.bin.tag != Tag::None);

        // SAFETY: tag determines the active union field
        unsafe {
            match self.bin.tag {
                Tag::None => {}
                Tag::File => {
                    let unscoped_package_name =
                        Dependency::unscoped_package_name(self.package_name.slice());
                    self.abs_dest_buf[dest_off..dest_off + unscoped_package_name.len()]
                        .copy_from_slice(unscoped_package_name);
                    dest_off += unscoped_package_name.len();
                    self.abs_dest_buf[dest_off] = 0;
                    let abs_dest_len = dest_off;
                    // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                    let abs_dest = ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                    Self::unlink_bin_or_shim(abs_dest);
                }
                Tag::NamedFile => {
                    let name = self.bin.value.named_file[0].slice(self.string_buf);
                    let normalized_name = normalized_bin_name(name);
                    if normalized_name.is_empty() {
                        return;
                    }

                    self.abs_dest_buf[dest_off..dest_off + normalized_name.len()]
                        .copy_from_slice(normalized_name);
                    dest_off += normalized_name.len();
                    self.abs_dest_buf[dest_off] = 0;
                    let abs_dest_len = dest_off;
                    // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                    let abs_dest = ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                    Self::unlink_bin_or_shim(abs_dest);
                }
                Tag::Map => {
                    let mut i = self.bin.value.map.begin();
                    let end = self.bin.value.map.end();

                    let abs_dest_dir_end = dest_off;

                    while i < end {
                        let bin_dest = self.extern_string_buf[i as usize].slice(self.string_buf);
                        let normalized_bin_dest = normalized_bin_name(bin_dest);
                        if normalized_bin_dest.is_empty() {
                            i += 2;
                            continue;
                        }

                        dest_off = abs_dest_dir_end;
                        self.abs_dest_buf[dest_off..dest_off + normalized_bin_dest.len()]
                            .copy_from_slice(normalized_bin_dest);
                        dest_off += normalized_bin_dest.len();
                        self.abs_dest_buf[dest_off] = 0;
                        let abs_dest_len = dest_off;
                        // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                        let abs_dest = ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                        Self::unlink_bin_or_shim(abs_dest);

                        i += 2;
                    }
                }
                Tag::Dir => {
                    let target = self.bin.value.dir.slice(self.string_buf);
                    if target.is_empty() {
                        return;
                    }

                    let package_dir = &self.abs_target_buf[0..package_dir_len];
                    let abs_target_dir =
                        path::join_abs_string_z(package_dir, &[target], path::Style::Auto);

                    let mut target_dir = match sys::open_dir_absolute(abs_target_dir) {
                        Ok(d) => d,
                        Err(err) => {
                            self.err = Some(err);
                            return;
                        }
                    };
                    let _close = scopeguard::guard((), |_| target_dir.close());

                    let abs_dest_dir_end = dest_off;

                    let mut iter = target_dir.iterate();
                    while let Some(entry) = iter.next().unwrap_or(None) {
                        match entry.kind {
                            sys::DirEntryKind::SymLink | sys::DirEntryKind::File => {
                                dest_off = abs_dest_dir_end;
                                self.abs_dest_buf[dest_off..dest_off + entry.name.len()]
                                    .copy_from_slice(entry.name);
                                dest_off += entry.name.len();
                                self.abs_dest_buf[dest_off] = 0;
                                let abs_dest_len = dest_off;
                                // SAFETY: abs_dest_buf[abs_dest_len] == 0 written above
                                let abs_dest =
                                    ZStr::from_raw(self.abs_dest_buf.as_ptr(), abs_dest_len);

                                Self::unlink_bin_or_shim(abs_dest);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/bin.zig (1162 lines)
//   confidence: medium
//   todos:      13
//   notes:      heavy buffer-pointer arithmetic reshaped to offsets; create_symlink defer hoisted to chmod_on_ok at each return; sys dir-iter / makePath / deleteTree placeholders
// ──────────────────────────────────────────────────────────────────────────
