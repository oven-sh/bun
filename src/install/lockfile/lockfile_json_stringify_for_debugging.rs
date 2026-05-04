use bun_core::fmt as bun_fmt;
use bun_paths::PathBuffer;
use bun_semver::ExternalString;

use bun_install::{
    self as install, invalid_package_id, Dependency, DependencyID, Npm, PackageID, Repository,
};
use bun_install::dependency::Behavior;
use bun_install::lockfile::{Lockfile, Package, PackageIndex, Tree};

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
    dep: Dependency,
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

    if dep.version.tag == Dependency::Version::Tag::Npm && dep.version.value.npm.is_alias {
        w.object_field(b"is_alias")?;
        w.write(true)?;
    }

    w.object_field(b"literal")?;
    w.write(dep.version.literal.slice(sb))?;

    w.object_field(<&'static str>::from(dep.version.tag).as_bytes())?;
    match dep.version.tag {
        Dependency::Version::Tag::Uninitialized => w.write_null()?,
        Dependency::Version::Tag::Npm => {
            w.begin_object()?;

            let info: Dependency::Version::NpmInfo = dep.version.value.npm;

            w.object_field(b"name")?;
            w.write(info.name.slice(sb))?;

            w.object_field(b"version")?;
            w.print(format_args!("\"{}\"", info.version.fmt(sb)))?;

            let _ = w.end_object();
        }
        Dependency::Version::Tag::DistTag => {
            w.begin_object()?;

            let info: Dependency::Version::TagInfo = dep.version.value.dist_tag;

            w.object_field(b"name")?;
            w.write(info.name.slice(sb))?;

            w.object_field(b"tag")?;
            w.write(info.name.slice(sb))?;

            let _ = w.end_object();
        }
        Dependency::Version::Tag::Tarball => {
            w.begin_object()?;

            let info: Dependency::Version::TarballInfo = dep.version.value.tarball;
            w.object_field(<&'static str>::from(info.uri.tag()).as_bytes())?;
            // TODO(port): `switch (info.uri) { inline else => |s| s.slice(sb) }` —
            // every TarballURI variant payload has `.slice(sb)`. Expand to explicit
            // match arms once the Rust TarballURI enum lands.
            w.write(info.uri.slice(sb))?;

            w.object_field(b"package_name")?;
            w.write(info.package_name.slice(sb))?;

            let _ = w.end_object();
        }
        Dependency::Version::Tag::Folder => {
            w.write(dep.version.value.folder.slice(sb))?;
        }
        Dependency::Version::Tag::Symlink => {
            w.write(dep.version.value.symlink.slice(sb))?;
        }
        Dependency::Version::Tag::Workspace => {
            w.write(dep.version.value.workspace.slice(sb))?;
        }
        Dependency::Version::Tag::Git => {
            w.begin_object()?;

            let info: Repository = dep.version.value.git;

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
        Dependency::Version::Tag::Github => {
            w.begin_object()?;

            let info: Repository = dep.version.value.github;

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
        Dependency::Version::Tag::Catalog => {
            w.begin_object()?;

            let info = dep.version.value.catalog;

            w.object_field(b"name")?;
            w.write(dep.name.slice(sb))?;

            w.object_field(b"version")?;
            w.print(format_args!(
                "\"catalog:{}\"",
                info.fmt_json(sb, Dependency::Version::FmtJsonOpts { quote: false })
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

        // TODO(port): Zig iterated `@typeInfo(Behavior).@"struct".fields[1..len-1]` (skips
        // the leading `_unused_first` and trailing `_padding` bool/padding fields). In Rust,
        // expose `Behavior::NAMED_FLAGS: &[(&'static str, fn(&Behavior) -> bool)]` (or a
        // bitflags iterator) on the ported Behavior type and iterate that here.
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
    w.write(<&'static str>::from(this.format).as_bytes())?;
    w.object_field(b"meta_hash")?;
    // TODO(port): std.fmt.bytesToHex(.., .lower) — provide bun_core::fmt::bytes_to_hex_lower.
    w.write(bun_fmt::bytes_to_hex_lower(&this.meta_hash).as_slice())?;

    {
        w.object_field(b"package_index")?;
        w.begin_object()?;

        let mut iter = this.package_index.iterator();
        while let Some(it) = iter.next() {
            let entry: PackageIndex::Entry = *it.value_ptr;
            let first_id = match entry {
                PackageIndex::Entry::Id(id) => id,
                PackageIndex::Entry::Ids(ref ids) => ids.as_slice()[0],
            };
            // TODO(port): MultiArrayList column accessor — `packages.items(.name)` in Zig.
            let name = this.packages.items_name()[first_id as usize].slice(sb);
            w.object_field(name)?;
            match entry {
                PackageIndex::Entry::Id(id) => w.write(id)?,
                PackageIndex::Entry::Ids(ref ids) => {
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
        let mut depth_buf = Tree::DepthBuf::uninit();
        let mut path_buf = PathBuffer::uninit();
        path_buf[..b"node_modules".len()].copy_from_slice(b"node_modules");

        for tree_id in 0..this.buffers.trees.as_slice().len() {
            w.begin_object()?;

            let tree = this.buffers.trees.as_slice()[tree_id];

            w.object_field(b"id")?;
            w.write(tree_id)?;

            let (relative_path, depth) = Lockfile::Tree::relative_path_and_depth(
                this,
                u32::try_from(tree_id).unwrap(),
                &mut path_buf,
                &mut depth_buf,
                Tree::RelativePathMode::NodeModules,
            );

            w.object_field(b"path")?;
            w.print(format_args!(
                "\"{}\"",
                bun_fmt::fmt_path(relative_path, bun_fmt::PathFmtOpts { path_sep: bun_fmt::PathSep::Posix })
            ))?;

            w.object_field(b"depth")?;
            w.write(depth)?;

            w.object_field(b"dependencies")?;
            {
                w.begin_object()?;

                for tree_dep_id in tree.dependencies.get(hoisted_deps) {
                    let tree_dep_id = *tree_dep_id;
                    let dep = dependencies[tree_dep_id as usize];
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
            let dep = dependencies[dep_id];
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
                let res = pkg.resolution;
                w.begin_object()?;

                w.object_field(b"tag")?;
                w.write(<&'static str>::from(res.tag).as_bytes())?;

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

            if (pkg.meta.arch as u16) != Npm::Architecture::ALL_VALUE {
                w.object_field(b"arch")?;
                w.begin_array()?;

                // TODO(port): `Npm.Architecture.NameMap.kvs` is a ComptimeStringMap's
                // backing kv array. The Rust port uses `phf::Map`; iterate `.entries()`.
                for (key, value) in Npm::Architecture::NAME_MAP.entries() {
                    if pkg.meta.arch.has(*value) {
                        w.write(key)?;
                    }
                }

                let _ = w.end_array();
            }

            if (pkg.meta.os as u16) != Npm::OperatingSystem::ALL_VALUE {
                w.object_field(b"os")?;
                w.begin_array()?;

                for (key, value) in Npm::OperatingSystem::NAME_MAP.entries() {
                    if pkg.meta.os.has(*value) {
                        w.write(key)?;
                    }
                }

                let _ = w.end_array();
            }

            w.object_field(b"integrity")?;
            if pkg.meta.integrity.tag != install::Integrity::Tag::Unknown {
                w.print(format_args!("\"{}\"", pkg.meta.integrity))?;
            } else {
                w.write_null()?;
            }

            w.object_field(b"man_dir")?;
            w.write(pkg.meta.man_dir.slice(sb))?;

            w.object_field(b"origin")?;
            w.write(<&'static str>::from(pkg.meta.origin).as_bytes())?;

            w.object_field(b"bin")?;
            match pkg.bin.tag {
                install::Bin::Tag::None => w.write_null()?,
                install::Bin::Tag::File => {
                    w.begin_object()?;

                    w.object_field(b"file")?;
                    w.write(pkg.bin.value.file.slice(sb))?;

                    let _ = w.end_object();
                }
                install::Bin::Tag::NamedFile => {
                    w.begin_object()?;

                    w.object_field(b"name")?;
                    w.write(pkg.bin.value.named_file[0].slice(sb))?;

                    w.object_field(b"file")?;
                    w.write(pkg.bin.value.named_file[1].slice(sb))?;

                    let _ = w.end_object();
                }
                install::Bin::Tag::Dir => {
                    w.object_field(b"dir")?;
                    w.write(pkg.bin.value.dir.slice(sb))?;
                }
                install::Bin::Tag::Map => {
                    w.begin_object()?;

                    let data: &[ExternalString] =
                        pkg.bin.value.map.get(this.buffers.extern_strings.as_slice());
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

                // TODO(port): `inline for (comptime std.meta.fieldNames(Lockfile.Scripts))` —
                // expose `Lockfile::Scripts::FIELD_NAMES: &[(&'static str, fn(&Scripts) -> &String)]`
                // (or a derive) on the ported Scripts struct and iterate it here.
                for (field_name, getter) in Lockfile::Scripts::FIELD_NAMES {
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
                let mut cursor: &mut [u8] = &mut buf[..];
                let _ = write!(cursor, "{}", k);
                buf.len() - cursor.len()
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
                let mut cursor: &mut [u8] = &mut buf[..];
                let _ = write!(cursor, "{}", k);
                buf.len() - cursor.len()
            };
            w.object_field(&buf[..len])?;
            w.print(format_args!("\"{}\"", v.fmt(sb)))?;
        }

        let _ = w.end_object();
    }

    let _ = w.end_object();
    Ok(())
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
//   todos:      9
//   notes:      JsonWriter trait is a placeholder; defer-endObject reshaped (see PORT NOTE); Behavior/Scripts field reflection needs helper consts on ported types.
// ──────────────────────────────────────────────────────────────────────────
