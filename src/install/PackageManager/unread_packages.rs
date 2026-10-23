//! yarn.lock and pnpm-lock.yaml do not record what only a package.json says: the `bin` and the
//! install scripts. For a registry package the migration takes both from the manifest. A git,
//! GitHub or tarball package is `Lockfile::unread` until a linker places it and reads its
//! package.json. Nothing is downloaded to read one.

use std::sync::OnceLock;

use bun_core::{ZStr, strings};
use bun_semver::ExternalString;

use super::{PackageManager, directories};
use crate::bin_real::Bin;
use crate::bun_json::Expr;
use crate::integrity::Integrity;
use crate::lockfile_real::package::{Package, PackageColumns as _, ResolverContext};
use crate::lockfile_real::{Lockfile, StringBuilder};
use crate::resolution::{Resolution, ResolutionType, Tag as ResolutionTag};
use crate::{Features, PackageID};

/// What a package.json says about a row.
pub(crate) struct Described {
    pub(crate) bin: Bin,
    /// The strings of `bin`.
    pub(crate) string_bytes: Vec<u8>,
    pub(crate) extern_strings: Vec<ExternalString>,
    pub(crate) has_install_script: bool,
    /// The package.json is of the bytes that the row pins, so the row can record it. If not, it
    /// only says what this install links.
    pub(crate) pinned: bool,
}

/// What the linker of one install read, by package id. A linker cannot grow the lockfile's
/// buffers, so the strings of a `bin` stay here until `PackageManager::adopt_described`.
pub(crate) struct DescribedPackages {
    /// The main thread fills the slot of a package before anything links its bins. `None`: its
    /// package.json cannot be read.
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
    /// Returns true if a copy of the package with the `.bun-tag` of the row has the bytes that the
    /// row pins: the commit of a repository, or the integrity of a tarball that was checked.
    fn row_pins(&self, resolution: &Resolution, integrity: &Integrity) -> bool {
        match resolution.tag {
            ResolutionTag::Git | ResolutionTag::Github => {
                !resolution.repository().resolved.is_empty()
            }
            ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                integrity.tag.is_supported() && !self.skips_verify(resolution.tag)
            }
            _ => false,
        }
    }

    /// Reads `bin` and `hasInstallScript` as a fresh resolve does. `path` is where the package.json
    /// is: a `binding.gyp` next to it counts as an install script. `None`: it does not parse.
    pub(crate) fn describe(
        &mut self,
        path: &[u8],
        contents: &[u8],
        pinned: bool,
    ) -> Option<Described> {
        crate::initialize_store();
        let source = bun_ast::Source::init_path_string(path, contents);
        let mut log = bun_ast::Log::init();
        let json = crate::bun_json::ParsedJson::parse_package_json(&source, &mut log).ok()?;

        let mut scratch = Lockfile::default();
        let mut package = Package::default();
        // The row has the dependencies.
        package
            .parse_with_json(
                &mut scratch,
                self,
                &mut log,
                &source,
                json.root,
                &mut BinAndScripts,
                Features::LINK,
            )
            .ok()?;
        Some(Described {
            bin: package.bin,
            string_bytes: core::mem::take(&mut scratch.buffers.string_bytes),
            extern_strings: core::mem::take(&mut scratch.buffers.extern_strings),
            has_install_script: package.meta.has_install_script(),
            pinned,
        })
    }

    /// `describe` for `folder` of the cache. It does not follow a link.
    pub(crate) fn describe_cached(&mut self, folder: &ZStr, pinned: bool) -> Option<Described> {
        let package_dir = [
            strings::without_trailing_slash(self.cache_directory_path.as_bytes()),
            bun_paths::SEP_STR.as_bytes(),
            folder.as_bytes(),
        ]
        .concat();
        let dir = bun_sys::Dir::open(&package_dir).ok()?;
        let json = crate::git_runner::read_package_json_in(&dir).ok()?;
        self.describe(&package_json_in(&package_dir), &json, pinned)
    }

    /// `describe` for a package that is in place: in `placed`, a folder of `node_modules` or of
    /// the store. The cache entry that the row pins has the package as it was published, so that
    /// one is read if it is there.
    ///
    /// `placed_as_pinned`: the copy in `placed` has the `.bun-tag` of the row and no patch.
    pub(crate) fn describe_placed(
        &mut self,
        resolution: &Resolution,
        integrity: &Integrity,
        placed: &[u8],
        placed_as_pinned: bool,
    ) -> Option<Described> {
        let entry = directories::cached_pinned_folder_name(self, resolution, integrity);
        if !entry.is_empty()
            && let Some(described) = self.describe_cached(entry, true)
        {
            return Some(described);
        }
        // This read follows a link, because `--backend=symlink` places each file as one.
        let path = package_json_in(placed);
        let json = bun_sys::File::read_from(bun_sys::Fd::cwd(), &path).ok()?;
        let pinned = placed_as_pinned && self.row_pins(resolution, integrity);
        self.describe(&path, &json, pinned)
    }

    /// Gives each row what the package.json of its bytes says. Call this only while nothing views
    /// the lockfile's buffers, which grow here. A migration is always saved, so nothing has to ask
    /// for that.
    pub(crate) fn adopt_described(&mut self, described: &DescribedPackages) {
        let before = self.lockfile.buffers.string_bytes.as_ptr();
        for (id, slot) in described.slots.iter().enumerate() {
            if let Some(Some(package)) = slot.get()
                && package.pinned
            {
                bun_core::handle_oom(self.lockfile.adopt(id as PackageID, package));
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
