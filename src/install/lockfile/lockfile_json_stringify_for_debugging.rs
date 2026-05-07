use bun_core::fmt as bun_fmt;
use bun_paths::PathBuffer;
use bun_semver::ExternalString;
use bun_semver::string::JsonFormatterOptions;

use crate::{invalid_package_id, Dependency, DependencyID, Npm, Origin, PackageID};
use crate::repository::Repository;
use crate::dependency::{Behavior, NpmInfo, TagInfo, TarballInfo, URI};
use crate::dependency::Tag as DependencyVersionTag;
use crate::bin::Tag as BinTag;
use crate::integrity::Tag as IntegrityTag;

use super::{package_index, tree, FormatVersion, Lockfile, Package};
use super::package::PackageListExt as _;
use super::package::scripts::Scripts as PackageScripts;
use super::tree::{DepthBuf, IteratorPathStyle, MAX_DEPTH};

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

    // SAFETY: tag-guarded union access — `value.npm` is the active variant when tag == Npm.
    if dep.version.tag == DependencyVersionTag::Npm && unsafe { dep.version.value.npm.is_alias } {
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

            // SAFETY: tag == Npm guards the `npm` union field.
            let info: &NpmInfo = unsafe { &*dep.version.value.npm };

            w.object_field(b"name")?;
            w.write(info.name.slice(sb))?;

            w.object_field(b"version")?;
            w.print(format_args!("\"{}\"", info.version.fmt(sb)))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::DistTag => {
            w.begin_object()?;

            // SAFETY: tag == DistTag guards the `dist_tag` union field.
            let info: TagInfo = unsafe { dep.version.value.dist_tag };

            w.object_field(b"name")?;
            w.write(info.name.slice(sb))?;

            w.object_field(b"tag")?;
            w.write(info.name.slice(sb))?;

            let _ = w.end_object();
        }
        DependencyVersionTag::Tarball => {
            w.begin_object()?;

            // SAFETY: tag == Tarball guards the `tarball` union field.
            let info: TarballInfo = unsafe { dep.version.value.tarball };
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
            // SAFETY: tag == Folder guards the `folder` union field.
            w.write(unsafe { dep.version.value.folder }.slice(sb))?;
        }
        DependencyVersionTag::Symlink => {
            // SAFETY: tag == Symlink guards the `symlink` union field.
            w.write(unsafe { dep.version.value.symlink }.slice(sb))?;
        }
        DependencyVersionTag::Workspace => {
            // SAFETY: tag == Workspace guards the `workspace` union field.
            w.write(unsafe { dep.version.value.workspace }.slice(sb))?;
        }
        DependencyVersionTag::Git => {
            w.begin_object()?;

            // SAFETY: tag == Git guards the `git` union field.
            let info: &Repository = unsafe { &*dep.version.value.git };

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

            // SAFETY: tag == Github guards the `github` union field.
            let info: &Repository = unsafe { &*dep.version.value.github };

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

            // SAFETY: tag == Catalog guards the `catalog` union field.
            let info = unsafe { dep.version.value.catalog };

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
                    u32::try_from(tree_id).unwrap(),
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
            json_stringify_dependency(this, w, u32::try_from(dep_id).unwrap(), dep, res)?;
        }

        let _ = w.end_array();
    }

    {
        w.object_field(b"packages")?;
        w.begin_array()?;

        for i in 0..this.packages.len() {
            let pkg: Package = this.packages.get(i);
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
                    // SAFETY: tag == File guards the `file` union field.
                    w.write(unsafe { pkg.bin.value.file }.slice(sb))?;

                    let _ = w.end_object();
                }
                BinTag::NamedFile => {
                    w.begin_object()?;

                    // SAFETY: tag == NamedFile guards the `named_file` union field.
                    let named_file = unsafe { pkg.bin.value.named_file };
                    w.object_field(b"name")?;
                    w.write(named_file[0].slice(sb))?;

                    w.object_field(b"file")?;
                    w.write(named_file[1].slice(sb))?;

                    let _ = w.end_object();
                }
                BinTag::Dir => {
                    w.object_field(b"dir")?;
                    // SAFETY: tag == Dir guards the `dir` union field.
                    w.write(unsafe { pkg.bin.value.dir }.slice(sb))?;
                }
                BinTag::Map => {
                    w.begin_object()?;

                    // SAFETY: tag == Map guards the `map` union field.
                    let data: &[ExternalString] =
                        unsafe { pkg.bin.value.map }.get(this.buffers.extern_strings.as_slice());
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

// TODO(port): placeholder trait for the `w: anytype` JSON write-stream protocol.
// Phase B: move into bun_core (or wherever std.json.WriteStream is ported) and bound
// `write` over a `JsonScalar` trait so bool/integer/&[u8] all dispatch through it.
pub trait JsonWriter {
    fn begin_object(&mut self) -> Result<(), bun_core::Error>;
    fn end_object(&mut self) -> Result<(), bun_core::Error>;
    fn begin_array(&mut self) -> Result<(), bun_core::Error>;
    fn end_array(&mut self) -> Result<(), bun_core::Error>;
    fn object_field(&mut self, name: &[u8]) -> Result<(), bun_core::Error>;
    fn write<T>(&mut self, value: T) -> Result<(), bun_core::Error>;
    fn write_null(&mut self) -> Result<(), bun_core::Error>;
    fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), bun_core::Error>;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/lockfile_json_stringify_for_debugging.zig (427 lines)
//   confidence: medium
//   todos:      6
//   notes:      JsonWriter trait is a placeholder; defer-endObject reshaped (see PORT NOTE); Behavior/Scripts field reflection via NAMED_FLAGS/FIELD_NAMES tables.
// ──────────────────────────────────────────────────────────────────────────
