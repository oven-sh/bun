use crate::lockfile::package::PackageColumns as _;
use bun_core::fmt as bun_fmt;
use bun_paths::PathBuffer;
use bun_semver::ExternalString;
use bun_semver::string::JsonFormatterOptions;

use crate::bin::Tag as BinTag;
use crate::dependency::Tag as DependencyVersionTag;
use crate::dependency::{Behavior, NpmInfo, TagInfo, TarballInfo, URI};
use crate::integrity::Tag as IntegrityTag;
use crate::repository::Repository;
use crate::{Dependency, DependencyID, Npm, Origin, PackageID, invalid_package_id};

use super::package::scripts::Scripts as PackageScripts;
use super::tree::{DepthBuf, IteratorPathStyle, MAX_DEPTH};
use super::{FormatVersion, Lockfile, Package, package_index, tree};

// TODO(port): `w: anytype` is a `std.json.WriteStream`-shaped writer. Phase B should
// introduce a `JsonWriter` trait in bun_core (or bun_collections) with the methods
// used below: begin_object/end_object/begin_array/end_array/object_field/write/write_null/print.
// `write` is generic over JSON-encodable scalars (bool, integers, &[u8]).
//
// PORT NOTE: Zig used `defer w.endObject() catch {}` so that closing braces are emitted
// on both success and error paths (with the close error swallowed). In Rust the `?`
// early-return drops the borrow on `w`, and a scopeguard would need a second `&mut w`.
// Since this output is debug-only and an error mid-stream already yields malformed JSON,
// the port emits the matching `end_*` call at the natural end of each scope and swallows
// its error with `let _ = ...;`. The error-path close is intentionally dropped.

fn json_stringify_dependency<W>(
    this: &Lockfile,
    w: &mut W,
    dep_id: DependencyID,
    dep: &Dependency,
    res: PackageID,
) -> Result<(), bun_core::Error>
// TODO(port): narrow error set
where
    W: JsonWriter,
{
    let sb = this.buffers.string_bytes.as_slice();

    w.begin_object()?;

    w.object_field(b"name")?;
    w.write(dep.name.slice(sb))?;

    if dep.version.tag == DependencyVersionTag::Npm && dep.version.npm().is_alias {
        w.object_field(b"is_alias")?;
        w.write(true)?;
    }

    w.object_field(b"literal")?;
    w.write(dep.version.literal.slice(sb))?;

    w.object_field(<&'static str>::from(dep.version.tag).as_bytes())?;
    match dep.version.tag {
        DependencyVersionTag::Uninitialized => w.write_null()?,
        DependencyVersionTag::Npm => {
            w.begin_object()?;

            let info: &NpmInfo = dep.version.npm();

            w.object_field(b"name")?;
            w.write(info.name.slice(sb))?;

            w.object_field(b"version")?;
            w.print(format_args!("\"{}\"", info.version.fmt(sb)))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::DistTag => {
            w.begin_object()?;

            let info: TagInfo = *dep.version.dist_tag();

            w.object_field(b"name")?;
            w.write(info.name.slice(sb))?;

            w.object_field(b"tag")?;
            w.write(info.name.slice(sb))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::Tarball => {
            w.begin_object()?;

            let info: TarballInfo = *dep.version.tarball();
            // Zig: `@tagName(info.uri)` then `switch (info.uri) { inline else => |s| s.slice(sb) }`
            // — every TarballURI variant payload has `.slice(sb)`.
            let (uri_tag, uri_slice): (&'static str, &[u8]) = match info.uri {
                URI::Local(ref s) => ("local", s.slice(sb)),
                URI::Remote(ref s) => ("remote", s.slice(sb)),
            };
            w.object_field(uri_tag.as_bytes())?;
            w.write(uri_slice)?;

            w.object_field(b"package_name")?;
            w.write(info.package_name.slice(sb))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::Folder => {
            w.write(dep.version.folder().slice(sb))?;
        }
        DependencyVersionTag::Symlink => {
            w.write(dep.version.symlink().slice(sb))?;
        }
        DependencyVersionTag::Workspace => {
            w.write(dep.version.workspace().slice(sb))?;
        }
        DependencyVersionTag::Git => {
            w.begin_object()?;

            let info: &Repository = dep.version.git();

            w.object_field(b"owner")?;
            w.write(info.owner.slice(sb))?;
            w.object_field(b"repo")?;
            w.write(info.repo.slice(sb))?;
            w.object_field(b"committish")?;
            w.write(info.committish.slice(sb))?;
            w.object_field(b"resolved")?;
            w.write(info.resolved.slice(sb))?;
            w.object_field(b"package_name")?;
            w.write(info.package_name.slice(sb))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::Github => {
            w.begin_object()?;

            let info: &Repository = dep.version.github();

            w.object_field(b"owner")?;
            w.write(info.owner.slice(sb))?;
            w.object_field(b"repo")?;
            w.write(info.repo.slice(sb))?;
            w.object_field(b"committish")?;
            w.write(info.committish.slice(sb))?;
            w.object_field(b"resolved")?;
            w.write(info.resolved.slice(sb))?;
            w.object_field(b"package_name")?;
            w.write(info.package_name.slice(sb))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::Catalog => {
            w.begin_object()?;

            let info = *dep.version.catalog();

            w.object_field(b"name")?;
            w.write(dep.name.slice(sb))?;

            w.object_field(b"version")?;
            w.print(format_args!(
                "\"catalog:{}\"",
                info.fmt_json(sb, JsonFormatterOptions { quote: false })
            ))?;

            let _ = w.end_object();
        }
    }

    w.object_field(b"package_id")?;
    if res == invalid_package_id {
        w.write_null()?;
    } else {
        w.write(res)?;
    }

    w.object_field(b"behavior")?;
    {
        w.begin_object()?;

        // Zig iterated `@typeInfo(Behavior).@"struct".fields[1..len-1]` (skips
        // the leading `_unused_first` and trailing `_padding` bool/padding fields).
        // The Rust port iterates `Behavior::NAMED_FLAGS` — a flat (name, fn) table.
        for (name, getter) in Behavior::NAMED_FLAGS {
            if getter(&dep.behavior) {
                w.object_field(name.as_bytes())?;
                w.write(true)?;
            }
        }

        let _ = w.end_object();
    }

    w.object_field(b"id")?;
    w.write(dep_id)?;

    let _ = w.end_object();
    Ok(())
}

pub fn json_stringify<W>(this: &Lockfile, w: &mut W) -> Result<(), bun_core::Error>
// TODO(port): narrow error set
where
    W: JsonWriter,
{
    let sb = this.buffers.string_bytes.as_slice();
    w.begin_object()?;

    w.object_field(b"format")?;
    w.write(format_version_name(this.format).as_bytes())?;
    w.object_field(b"meta_hash")?;
    {
        // std.fmt.bytesToHex(.., .lower)
        let mut hex = [0u8; 64];
        let n = bun_fmt::bytes_to_hex_lower(&this.meta_hash, &mut hex);
        w.write(&hex[..n])?;
    }

    {
        w.object_field(b"package_index")?;
        w.begin_object()?;

        for (_k, entry) in this.package_index.iter() {
            let entry: &package_index::Entry = entry;
            let first_id = match entry {
                package_index::Entry::Id(id) => *id,
                package_index::Entry::Ids(ids) => ids.as_slice()[0],
            };
            // TODO(port): MultiArrayList column accessor — `packages.items(.name)` in Zig.
            let name = this.packages.items_name()[first_id as usize].slice(sb);
            w.object_field(name)?;
            match entry {
                package_index::Entry::Id(id) => w.write(*id)?,
                package_index::Entry::Ids(ids) => {
                    w.begin_array()?;
                    for id in ids.as_slice() {
                        w.write(*id)?;
                    }
                    w.end_array()?;
                }
            }
        }

        let _ = w.end_object();
    }
    {
        w.object_field(b"trees")?;
        w.begin_array()?;

        let dependencies = this.buffers.dependencies.as_slice();
        let hoisted_deps = this.buffers.hoisted_dependencies.as_slice();
        let resolutions = this.buffers.resolutions.as_slice();
        let mut depth_buf: DepthBuf = [0; MAX_DEPTH];
        let mut path_buf = PathBuffer::uninit();
        path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");

        for tree_id in 0..this.buffers.trees.as_slice().len() {
            w.begin_object()?;

            let tree = this.buffers.trees.as_slice()[tree_id];

            w.object_field(b"id")?;
            w.write(tree_id)?;

            let (relative_path, depth) =
                tree::relative_path_and_depth::<{ IteratorPathStyle::NodeModules }>(
                    this.buffers.trees.as_slice(),
                    this.buffers.dependencies.as_slice(),
                    this.buffers.string_bytes.as_slice(),
                    u32::try_from(tree_id).expect("int cast"),
                    &mut path_buf,
                    &mut depth_buf,
                );

            w.object_field(b"path")?;
            w.print(format_args!(
                "\"{}\"",
                bun_fmt::fmt_path(
                    relative_path,
                    bun_fmt::PathFormatOptions {
                        path_sep: bun_fmt::PathSep::Posix,
                        ..Default::default()
                    },
                )
            ))?;

            w.object_field(b"depth")?;
            w.write(depth)?;

            w.object_field(b"dependencies")?;
            {
                w.begin_object()?;

                for tree_dep_id in tree.dependencies.get(hoisted_deps) {
                    let tree_dep_id = *tree_dep_id;
                    let dep = &dependencies[tree_dep_id as usize];
                    let package_id = resolutions[tree_dep_id as usize];

                    w.object_field(dep.name.slice(sb))?;
                    {
                        w.begin_object()?;

                        w.object_field(b"id")?;
                        w.write(tree_dep_id)?;

                        w.object_field(b"package_id")?;
                        w.write(package_id)?;

                        let _ = w.end_object();
                    }
                }

                let _ = w.end_object();
            }

            let _ = w.end_object();
        }

        let _ = w.end_array();
    }

    {
        w.object_field(b"dependencies")?;
        w.begin_array()?;

        let dependencies = this.buffers.dependencies.as_slice();
        let resolutions = this.buffers.resolutions.as_slice();

        for dep_id in 0..dependencies.len() {
            let dep = &dependencies[dep_id];
            let res = resolutions[dep_id];
            json_stringify_dependency(this, w, u32::try_from(dep_id).expect("int cast"), dep, res)?;
        }

        let _ = w.end_array();
    }

    {
        w.object_field(b"packages")?;
        w.begin_array()?;

        for i in 0..this.packages.len() {
            let pkg: Package = *this.packages.get(i);
            w.begin_object()?;

            w.object_field(b"id")?;
            w.write(i)?;

            w.object_field(b"name")?;
            w.write(pkg.name.slice(sb))?;

            w.object_field(b"name_hash")?;
            w.write(pkg.name_hash)?;

            w.object_field(b"resolution")?;
            {
                let res = &pkg.resolution;
                w.begin_object()?;

                w.object_field(b"tag")?;
                w.write(res.tag.name().unwrap_or("").as_bytes())?;

                w.object_field(b"value")?;
                w.print(format_args!("\"{}\"", res.fmt(sb, bun_fmt::PathSep::Posix)))?;

                w.object_field(b"resolved")?;
                w.print(format_args!("\"{}\"", res.fmt_url(sb)))?;

                let _ = w.end_object();
            }

            w.object_field(b"dependencies")?;
            {
                w.begin_array()?;

                for dep_id in pkg.dependencies.off..pkg.dependencies.off + pkg.dependencies.len {
                    w.write(dep_id)?;
                }

                let _ = w.end_array();
            }

            if pkg.meta.arch.0 != Npm::Architecture::ALL_VALUE {
                w.object_field(b"arch")?;
                w.begin_array()?;

                // Zig: `Npm.Architecture.NameMap.kvs` — ComptimeStringMap kv array.
                for (key, value) in Npm::Architecture::NAME_MAP_KVS {
                    if pkg.meta.arch.has(*value) {
                        w.write(*key)?;
                    }
                }

                let _ = w.end_array();
            }

            if pkg.meta.os.0 != Npm::OperatingSystem::ALL_VALUE {
                w.object_field(b"os")?;
                w.begin_array()?;

                for (key, value) in Npm::OperatingSystem::NAME_MAP_KVS {
                    if pkg.meta.os.has(*value) {
                        w.write(*key)?;
                    }
                }

                let _ = w.end_array();
            }

            w.object_field(b"integrity")?;
            if pkg.meta.integrity.tag != IntegrityTag::UNKNOWN {
                w.print(format_args!("\"{}\"", pkg.meta.integrity))?;
            } else {
                w.write_null()?;
            }

            w.object_field(b"man_dir")?;
            w.write(pkg.meta.man_dir.slice(sb))?;

            w.object_field(b"origin")?;
            w.write(origin_name(pkg.meta.origin).as_bytes())?;

            w.object_field(b"bin")?;
            match pkg.bin.tag {
                BinTag::None => w.write_null()?,
                BinTag::File => {
                    w.begin_object()?;

                    w.object_field(b"file")?;
                    w.write(pkg.bin.file().slice(sb))?;

                    let _ = w.end_object();
                }
                BinTag::NamedFile => {
                    w.begin_object()?;

                    let named_file = *pkg.bin.named_file();
                    w.object_field(b"name")?;
                    w.write(named_file[0].slice(sb))?;

                    w.object_field(b"file")?;
                    w.write(named_file[1].slice(sb))?;

                    let _ = w.end_object();
                }
                BinTag::Dir => {
                    w.object_field(b"dir")?;
                    w.write(pkg.bin.dir().slice(sb))?;
                }
                BinTag::Map => {
                    w.begin_object()?;

                    // SAFETY: tag == Map guards the `map` union field.
                    let data: &[ExternalString] =
                        pkg.bin.map().get(this.buffers.extern_strings.as_slice());
                    let mut bin_i: usize = 0;
                    while bin_i < data.len() {
                        w.object_field(data[bin_i].slice(sb))?;
                        w.write(data[bin_i + 1].slice(sb))?;
                        bin_i += 2;
                    }

                    let _ = w.end_object();
                }
            }

            {
                w.object_field(b"scripts")?;
                w.begin_object()?;

                // Zig: `inline for (comptime std.meta.fieldNames(Lockfile.Scripts))` —
                // tabulated explicitly via `Package::Scripts::FIELD_NAMES` since
                // Rust has no field-by-name reflection.
                for (field_name, getter) in PackageScripts::FIELD_NAMES {
                    let script = getter(&pkg.scripts).slice(sb);
                    if !script.is_empty() {
                        w.object_field(field_name.as_bytes())?;
                        w.write(script)?;
                    }
                }

                let _ = w.end_object();
            }

            let _ = w.end_object();
        }

        let _ = w.end_array();
    }

    let mut buf = [0u8; 100];

    w.object_field(b"workspace_paths")?;
    {
        w.begin_object()?;

        debug_assert_eq!(
            this.workspace_paths.keys().len(),
            this.workspace_paths.values().len()
        );
        for (k, v) in this
            .workspace_paths
            .keys()
            .iter()
            .zip(this.workspace_paths.values())
        {
            // std.fmt.printInt(&buf, k, 10, .lower, .{})
            let len = {
                use std::io::Write;
                let cap = buf.len();
                let mut cursor: &mut [u8] = &mut buf[..];
                let _ = write!(cursor, "{}", k);
                cap - cursor.len()
            };
            w.object_field(&buf[..len])?;
            w.write(v.slice(sb))?;
        }

        let _ = w.end_object();
    }
    w.object_field(b"workspace_versions")?;
    {
        w.begin_object()?;

        debug_assert_eq!(
            this.workspace_versions.keys().len(),
            this.workspace_versions.values().len()
        );
        for (k, v) in this
            .workspace_versions
            .keys()
            .iter()
            .zip(this.workspace_versions.values())
        {
            let len = {
                use std::io::Write;
                let cap = buf.len();
                let mut cursor: &mut [u8] = &mut buf[..];
                let _ = write!(cursor, "{}", k);
                cap - cursor.len()
            };
            w.object_field(&buf[..len])?;
            w.print(format_args!("\"{}\"", v.fmt(sb)))?;
        }

        let _ = w.end_object();
    }

    let _ = w.end_object();
    Ok(())
}

/// Mirrors Zig `@tagName(this.format)` for the non-exhaustive `FormatVersion`.
fn format_version_name(v: FormatVersion) -> &'static str {
    match v {
        FormatVersion::V0 => "v0",
        FormatVersion::V1 => "v1",
        FormatVersion::V2 => "v2",
        FormatVersion::V3 => "v3",
        _ => "",
    }
}

/// Mirrors Zig `@tagName(pkg.meta.origin)`.
fn origin_name(o: Origin) -> &'static str {
    match o {
        Origin::Local => "local",
        Origin::Npm => "npm",
        Origin::Tarball => "tarball",
    }
}

/// Port of the `w: anytype` `std.json.WriteStream` protocol used by
/// `Lockfile.jsonStringify`. `write` is bounded over [`JsonScalar`] so the
/// concrete [`WriteStream`] impl can encode bool / integer / byte-string
/// uniformly (Zig's `WriteStream.write` switches on `@TypeOf` at comptime).
pub trait JsonWriter {
    fn begin_object(&mut self) -> Result<(), bun_core::Error>;
    fn end_object(&mut self) -> Result<(), bun_core::Error>;
    fn begin_array(&mut self) -> Result<(), bun_core::Error>;
    fn end_array(&mut self) -> Result<(), bun_core::Error>;
    fn object_field(&mut self, name: &[u8]) -> Result<(), bun_core::Error>;
    fn write<T: JsonScalar>(&mut self, value: T) -> Result<(), bun_core::Error>;
    fn write_null(&mut self) -> Result<(), bun_core::Error>;
    /// Zig: `WriteStream.print` — emits the formatted bytes verbatim as a
    /// complete value (caller is responsible for any quoting / escaping).
    fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error>;
}

/// Dispatch trait standing in for Zig's `@TypeOf` switch inside
/// `std.json.WriteStream.write`. Each impl emits the JSON encoding of `self`
/// into `out` (no leading/trailing separator — the writer handles that).
pub trait JsonScalar {
    fn write_json(&self, out: &mut Vec<u8>, opts: WriteStreamOptions);
}

impl JsonScalar for bool {
    #[inline]
    fn write_json(&self, out: &mut Vec<u8>, _: WriteStreamOptions) {
        out.extend_from_slice(if *self { b"true" } else { b"false" });
    }
}

macro_rules! json_scalar_uint {
    ($($t:ty),+ $(,)?) => {$(
        impl JsonScalar for $t {
            #[inline]
            fn write_json(&self, out: &mut Vec<u8>, opts: WriteStreamOptions) {
                use std::io::Write as _;
                // Zig std.json: `.emit_nonportable_numbers_as_strings` quotes any
                // integer outside ±2^53 so JS `JSON.parse` round-trips exactly.
                let v = *self as u64;
                if opts.emit_nonportable_numbers_as_strings && v > (1u64 << 53) {
                    let _ = write!(out, "\"{}\"", v);
                } else {
                    let _ = write!(out, "{}", v);
                }
            }
        }
    )+};
}
json_scalar_uint!(u8, u16, u32, u64, usize);

impl JsonScalar for &[u8] {
    fn write_json(&self, out: &mut Vec<u8>, _: WriteStreamOptions) {
        encode_json_string(self, out);
    }
}
impl<const N: usize> JsonScalar for &[u8; N] {
    #[inline]
    fn write_json(&self, out: &mut Vec<u8>, opts: WriteStreamOptions) {
        self.as_slice().write_json(out, opts);
    }
}

/// Zig: `std.json.encodeJsonString` — quote + escape the minimal RFC-8259 set
/// (`"`, `\`, U+0000..U+001F). Input is treated as already-valid UTF-8/WTF-8;
/// the lockfile string buffer never carries lone control bytes outside that
/// range, so the high-bit passthrough matches Zig's behaviour.
fn encode_json_string(s: &[u8], out: &mut Vec<u8>) {
    out.push(b'"');
    for &c in s {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x00..=0x1F => {
                out.extend_from_slice(b"\\u00");
                out.extend_from_slice(&bun_core::fmt::hex_byte_lower(c));
            }
            _ => out.push(c),
        }
    }
    out.push(b'"');
}

/// Options mirroring `std.json.StringifyOptions`. Only the three fields the
/// lockfile binding sets are modelled; the rest of std.json's surface is unused
/// here.
#[derive(Clone, Copy)]
pub struct WriteStreamOptions {
    /// `.whitespace = .indent_N` — number of spaces per nesting level. `0`
    /// would be `.minified`; the binding always passes `2`.
    pub indent: usize,
    pub emit_nonportable_numbers_as_strings: bool,
    // `emit_null_optional_fields` is consumed by Zig's reflection-based
    // `stringify`, not by `WriteStream` itself; `jsonStringify` is hand-rolled
    // and emits `write_null()` explicitly, so the flag is a no-op here. Kept
    // for spec parity with the call site in `install_binding.zig`.
    pub emit_null_optional_fields: bool,
}

/// Port of `std.json.WriteStream` over an in-memory `Vec<u8>`, sufficient for
/// `std.json.fmt(lockfile, opts)` → `allocPrint` as used by
/// `bun_install_js_bindings::jsParseLockfile` (install_binding.zig).
pub struct WriteStream {
    pub out: Vec<u8>,
    opts: WriteStreamOptions,
    depth: usize,
    /// Per open container: have we emitted ≥1 element yet (i.e. does the next
    /// element need a leading `,`)?
    had_element: Vec<bool>,
    /// Set by `object_field`; the immediately-following `write`/`print` is the
    /// field's value and so skips the element separator (which `object_field`
    /// already emitted).
    after_field: bool,
}

impl WriteStream {
    pub fn new(opts: WriteStreamOptions) -> Self {
        Self {
            out: Vec::new(),
            opts,
            depth: 0,
            had_element: Vec::new(),
            after_field: false,
        }
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.out
    }

    fn newline_indent(&mut self) {
        if self.opts.indent == 0 {
            return;
        }
        self.out.push(b'\n');
        for _ in 0..self.depth * self.opts.indent {
            self.out.push(b' ');
        }
    }

    /// Emit the `,` + newline + indent that precedes the next element of the
    /// current container (or just newline + indent for the first). Object
    /// values short-circuit: their separator was emitted by `object_field`.
    fn value_start(&mut self) {
        if self.after_field {
            self.after_field = false;
            return;
        }
        if let Some(had) = self.had_element.last_mut() {
            if *had {
                self.out.push(b',');
            }
            *had = true;
            self.newline_indent();
        }
    }
}

impl JsonWriter for WriteStream {
    fn begin_object(&mut self) -> Result<(), bun_core::Error> {
        self.value_start();
        self.out.push(b'{');
        self.depth += 1;
        self.had_element.push(false);
        Ok(())
    }
    fn end_object(&mut self) -> Result<(), bun_core::Error> {
        let had = self.had_element.pop().unwrap_or(false);
        self.depth -= 1;
        if had {
            self.newline_indent();
        }
        self.out.push(b'}');
        Ok(())
    }
    fn begin_array(&mut self) -> Result<(), bun_core::Error> {
        self.value_start();
        self.out.push(b'[');
        self.depth += 1;
        self.had_element.push(false);
        Ok(())
    }
    fn end_array(&mut self) -> Result<(), bun_core::Error> {
        let had = self.had_element.pop().unwrap_or(false);
        self.depth -= 1;
        if had {
            self.newline_indent();
        }
        self.out.push(b']');
        Ok(())
    }
    fn object_field(&mut self, name: &[u8]) -> Result<(), bun_core::Error> {
        self.value_start();
        encode_json_string(name, &mut self.out);
        self.out
            .extend_from_slice(if self.opts.indent > 0 { b": " } else { b":" });
        self.after_field = true;
        Ok(())
    }
    fn write<T: JsonScalar>(&mut self, value: T) -> Result<(), bun_core::Error> {
        self.value_start();
        value.write_json(&mut self.out, self.opts);
        Ok(())
    }
    fn write_null(&mut self) -> Result<(), bun_core::Error> {
        self.value_start();
        self.out.extend_from_slice(b"null");
        Ok(())
    }
    fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error> {
        use std::io::Write as _;
        self.value_start();
        let _ = self.out.write_fmt(args);
        Ok(())
    }
}

// ported from: src/install/lockfile/lockfile_json_stringify_for_debugging.zig
