//! The package.json of a `Lockfile::unread` package: a linker reads it to link, a save records it.

use std::sync::OnceLock;

use bun_core::{ZBox, ZStr, strings};
use bun_semver::ExternalString;

use super::{PackageManager, directories};
use crate::bin_real::Bin;
use crate::bun_json::Expr;
use crate::lockfile_real::package::{Package, PackageColumns as _, ResolverContext};
use crate::lockfile_real::{Lockfile, StringBuilder};
use crate::resolution::ResolutionType;
use crate::{Features, PackageID};

/// What a package.json says about a row.
#[derive(Default)]
pub(crate) struct Described {
    pub(crate) bin: Bin,
    /// The strings of `bin`.
    pub(crate) string_bytes: Vec<u8>,
    pub(crate) extern_strings: Vec<ExternalString>,
    pub(crate) has_install_script: bool,
}

/// What the linker of one install read to link, by package id. A row records none of it.
pub(crate) struct DescribedPackages {
    /// Set on the main thread before a task of the package starts. `None`: nothing to read.
    slots: Box<[OnceLock<Option<Described>>]>,
}

impl DescribedPackages {
    /// `None` unless the lockfile has an unread package.
    pub(crate) fn for_linker(lockfile: &Lockfile) -> Option<Box<DescribedPackages>> {
        if lockfile.unread.count() == 0 {
            return None;
        }
        let slots = (0..lockfile.packages.len())
            .map(|_| OnceLock::new())
            .collect();
        Some(Box::new(DescribedPackages { slots }))
    }

    pub(crate) fn get(&self, id: PackageID) -> Option<&Described> {
        self.slots.get(id as usize)?.get()?.as_ref()
    }

    /// Returns true if `id` is unread and nothing has read its package.json yet.
    pub(crate) fn wants(&self, lockfile: &Lockfile, id: PackageID) -> bool {
        lockfile.is_unread(id)
            && (self.slots.get(id as usize)).is_some_and(|slot| slot.get().is_none())
    }

    pub(crate) fn set(&self, id: PackageID, described: Option<Described>) {
        let _ = self.slots[id as usize].set(described);
    }

    /// The `bin` of a package, and the buffers of its strings.
    pub(crate) fn bin_of<'a>(
        &'a self,
        lockfile: &'a Lockfile,
        id: PackageID,
    ) -> (Bin, &'a [u8], &'a [ExternalString]) {
        match self.get(id) {
            Some(described) => (
                described.bin,
                described.string_bytes.as_slice(),
                described.extern_strings.as_slice(),
            ),
            None => (
                lockfile.packages.items_bin()[id as usize],
                lockfile.buffers.string_bytes.as_slice(),
                lockfile.buffers.extern_strings.as_slice(),
            ),
        }
    }
}

/// Parses a package.json for a row that keeps its name and its resolution.
struct BinAndScripts;

impl ResolverContext for BinAndScripts {
    fn resolve(
        &mut self,
        _builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> crate::Result<ResolutionType<u64>> {
        Ok(ResolutionType::default())
    }

    // An unsafe `name` is not an error here.
    fn fallback_name(&self) -> Option<Vec<u8>> {
        Some(Vec::new())
    }
}

impl PackageManager {
    /// Reads `bin` and `hasInstallScript` as a fresh resolve does, `binding.gyp` beside `path` too.
    fn describe(&mut self, id: PackageID, path: &[u8], contents: &[u8]) -> Option<Described> {
        crate::initialize_store();
        let source = bun_ast::Source::init_path_string(path, contents);
        let mut log = bun_ast::Log::init();
        let json = match crate::bun_json::ParsedJson::parse_package_json(&source, &mut log) {
            Ok(json) => json,
            Err(err) => return self.unreadable(id, "parse", err.name().as_bytes()),
        };

        let mut scratch = Lockfile::default();
        let mut package = Package::default();
        // The row has the dependencies.
        let parsed = package.parse_with_json(
            &mut scratch,
            self,
            &mut log,
            &source,
            json.root,
            &mut BinAndScripts,
            Features::LINK,
        );
        if let Err(err) = parsed {
            return self.unreadable(id, "parse", err.name().as_bytes());
        }
        Some(Described {
            bin: package.bin,
            string_bytes: core::mem::take(&mut scratch.buffers.string_bytes),
            extern_strings: core::mem::take(&mut scratch.buffers.extern_strings),
            has_install_script: package.meta.has_install_script(),
        })
    }

    /// The install stops before it saves a row that could not be read.
    fn unreadable(&mut self, id: PackageID, verb: &str, why: &[u8]) -> Option<Described> {
        let name = self.lockfile.packages.items_name()[id as usize];
        let name = self.lockfile.str(&name).to_vec();
        self.log_mut().add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "\"package.json\" for \"{}\" failed to {}: {}",
                bun_core::fmt::for_terminal(bstr::BStr::new(&name)),
                verb,
                bstr::BStr::new(why)
            ),
        );
        None
    }

    /// A package that has no package.json has no bin and no script.
    fn read_failed(&mut self, id: PackageID, err: &bun_sys::Error) -> Option<Described> {
        if err.get_errno() == bun_sys::E::ENOENT {
            return Some(Described::default());
        }
        self.unreadable(id, "open", err.name())
    }

    /// `describe` for `folder` of the cache. `None` if the cache does not have it complete.
    pub(crate) fn describe_cached(&mut self, id: PackageID, folder: &ZStr) -> Option<Described> {
        // `cache_directory_path` is empty until the cache directory is open.
        let cache_dir = directories::try_get_cache_directory(self).ok()?;
        let tag = self.lockfile.packages.items_resolution()[id as usize].tag;
        if folder.is_empty() || !directories::is_package_in_cache_at(cache_dir, folder, tag) {
            return None;
        }
        let json = (bun_sys::Dir::borrow(&cache_dir).open_at(folder.as_bytes()))
            .and_then(|dir| crate::git_runner::read_package_json_in(&dir));
        match json {
            Ok(json) => {
                let package_dir = [
                    strings::without_trailing_slash(self.cache_directory_path.as_bytes()),
                    bun_paths::SEP_STR.as_bytes(),
                    folder.as_bytes(),
                ]
                .concat();
                self.describe(id, &package_json_in(&package_dir), &json)
            }
            // An older version cached a checkout whose package.json is a link. Nothing uses it.
            Err(err) if err.get_errno() == bun_sys::E::ELOOP => None,
            Err(err) => self.read_failed(id, &err),
        }
    }

    /// The cache entry of the bytes that row `id` pins. Empty if the row pins none.
    fn pinned_cache_entry(&self, id: PackageID) -> ZBox {
        let packages = self.lockfile.packages.slice();
        let resolution = &packages.items_resolution()[id as usize];
        let integrity = &packages.items_meta()[id as usize].integrity;
        // Not the buffer of the other names: a linker asks while it holds one of them.
        let mut buf = bun_paths::path_buffer_pool::get();
        let entry = directories::cached_pinned_folder_name(self, &mut buf.0, resolution, integrity);
        ZBox::from_bytes(entry.as_bytes())
    }

    /// `describe` for a package in place: its pinned cache entry, else the copy in `placed`.
    pub(crate) fn describe_placed(&mut self, id: PackageID, placed: &[u8]) -> Option<Described> {
        let entry = self.pinned_cache_entry(id);
        if let Some(described) = self.describe_cached(id, &entry) {
            return Some(described);
        }
        // This read follows a link, because `--backend=symlink` places each file as one.
        let path = package_json_in(placed);
        match bun_sys::File::read_from(bun_sys::Fd::cwd(), &path) {
            Ok(json) => self.describe(id, &path, &json),
            Err(err) => self.read_failed(id, &err),
        }
    }

    /// Before a save. Grows the lockfile's buffers, so nothing may view them while this runs.
    pub fn record_unread_from_cache(&mut self) {
        if self.lockfile.unread.count() == 0 {
            return;
        }
        let before = self.lockfile.buffers.string_bytes.as_ptr();
        for id in 0..self.lockfile.unread.bit_length() as PackageID {
            if !self.lockfile.is_unread(id) {
                continue;
            }
            let entry = self.pinned_cache_entry(id);
            if let Some(described) = self.describe_cached(id, &entry) {
                bun_core::handle_oom(self.lockfile.adopt(id, &described));
            }
        }
        // `UpdateRequest::version_buf` views all of `string_bytes`.
        let after = bun_ptr::RawSlice::new(self.lockfile.buffers.string_bytes.as_slice());
        for request in &mut self.update_requests {
            if request.version_buf.as_ptr().cast::<u8>() == before {
                request.version_buf = after;
            }
        }
    }
}

fn package_json_in(package_dir: &[u8]) -> Vec<u8> {
    [
        strings::without_trailing_slash(package_dir),
        bun_paths::SEP_STR.as_bytes(),
        b"package.json",
    ]
    .concat()
}

impl Lockfile {
    /// The row is no longer unread.
    pub(crate) fn adopt(
        &mut self,
        id: PackageID,
        described: &Described,
    ) -> Result<(), bun_alloc::AllocError> {
        let mut builder = crate::string_builder!(self);
        let extern_strings_count = described.bin.count(
            &described.string_bytes,
            &described.extern_strings,
            &mut builder,
        );
        builder.allocate()?;
        let extern_strings = &mut self.buffers.extern_strings;
        let start = extern_strings.len();
        let bin = described.bin.clone_with_buffers(
            &described.string_bytes,
            &described.extern_strings,
            start as u32,
            bun_core::vec::grow_default(extern_strings, extern_strings_count as usize),
            &mut builder,
        );
        builder.clamp();

        self.packages.items_bin_mut()[id as usize] = bin;
        self.packages.items_meta_mut()[id as usize]
            .set_has_install_script(described.has_install_script);
        self.unread.unset(id as usize);
        Ok(())
    }
}
