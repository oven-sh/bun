//! The lockfile of another package manager does not record what only a package.json says: the
//! `bin` and the install scripts. For a registry package the migration takes both from the
//! manifest. A git, GitHub or tarball row stays `HasInstallScript::Unread` until an install meets
//! its package.json: in the cache when the lockfile is loaded, or where a linker puts the package.
//! Nothing is downloaded to read one.

use bun_core::strings;
use bun_semver::ExternalString;

use super::options::Enable;
use super::{PackageManager, directories};
use crate::bin_real::Bin;
use crate::bun_json::Expr;
use crate::lockfile_real::package::{Package, PackageColumns as _, ResolverContext};
use crate::lockfile_real::{Lockfile, StringBuilder};
use crate::resolution::{Resolution, ResolutionType, Tag as ResolutionTag};
use crate::{Features, PackageID};

/// What a package.json says about a row. The strings of `bin` are kept here, because a linker
/// cannot grow the lockfile's buffers: `PackageManager::adopt_described` copies them afterwards.
#[derive(Default)]
pub(crate) struct Described {
    pub(crate) bin: Bin,
    pub(crate) string_bytes: Vec<u8>,
    pub(crate) extern_strings: Vec<ExternalString>,
    pub(crate) has_install_script: bool,
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
    /// Reads `bin` and `hasInstallScript` as a fresh resolve does. `path` is where the package.json
    /// is: a `binding.gyp` next to it counts as an install script. `None`: it does not parse.
    pub(crate) fn describe(&mut self, path: &[u8], contents: &[u8]) -> Option<Described> {
        crate::initialize_store();
        let source = bun_ast::Source::init_path_string(path, contents);
        let mut log = bun_ast::Log::init();
        let json = crate::bun_json::ParsedJson::parse_package_json(&source, &mut log).ok()?;

        let mut scratch = Lockfile::default();
        let mut package = Package::default();
        let only_own_fields = Features {
            dependencies: false,
            peer_dependencies: false,
            ..Features::default()
        };
        package
            .parse_with_json(
                &mut scratch,
                self,
                &mut log,
                &source,
                json.root,
                &mut BinAndScripts,
                only_own_fields,
            )
            .ok()?;
        Some(Described {
            bin: package.bin,
            string_bytes: core::mem::take(&mut scratch.buffers.string_bytes),
            extern_strings: core::mem::take(&mut scratch.buffers.extern_strings),
            has_install_script: package.meta.has_install_script(),
        })
    }

    /// `describe` for the package.json in `package_dir`, an absolute path. `None`: it cannot be
    /// read.
    pub(crate) fn describe_in(&mut self, package_dir: &[u8], tag: ResolutionTag) -> Option<Described> {
        let dir = bun_sys::Dir::open(package_dir).ok()?;
        match crate::git_runner::read_package_json_in(&dir) {
            Ok(contents) => {
                let path = [
                    strings::without_trailing_slash(package_dir),
                    bun_paths::SEP_STR.as_bytes(),
                    b"package.json",
                ]
                .concat();
                self.describe(&path, &contents)
            }
            // A repository needs no package.json.
            Err(err) if tag.is_git() && err.get_errno() == bun_sys::E::ENOENT => {
                Some(Described::default())
            }
            Err(_) => None,
        }
    }

    /// Gives each row what its package.json says. Call this only while nothing views the lockfile's
    /// buffers, which grow here.
    pub(crate) fn adopt_described(&mut self, described: &[(PackageID, Described)]) {
        if described.is_empty() {
            return;
        }
        let before = self.lockfile.buffers.string_bytes.as_ptr();
        for (id, described) in described {
            bun_core::handle_oom(self.lockfile.adopt(*id, described));
        }
        let after = bun_ptr::RawSlice::new(self.lockfile.buffers.string_bytes.as_slice());
        for request in &mut self.update_requests {
            if request.version_buf.as_ptr().cast::<u8>() == before {
                request.version_buf = after;
            }
        }
        // bun.lock has these rows as `"hasInstallScript": null`.
        self.options.enable.set(Enable::FORCE_SAVE_LOCKFILE, true);
    }

    /// Describes the unread rows whose package is in the cache under the bytes that the row pins.
    /// Whatever is not there waits for a linker.
    #[cold]
    #[inline(never)]
    pub(crate) fn describe_unread_from_cache(&mut self) {
        let Some(cache_dir) = directories::existing_cache_directory(self) else {
            return;
        };
        let mut described: Vec<(PackageID, Described)> = Vec::new();
        for id in 0..self.lockfile.packages.len() {
            let meta = self.lockfile.packages.items_meta()[id];
            if !meta.is_unread() {
                continue;
            }
            let resolution: Resolution = self.lockfile.packages.items_resolution()[id];
            let folder = directories::cached_pinned_folder_name(self, &resolution, &meta.integrity);
            if folder.is_empty()
                || !directories::is_package_in_cache_at(cache_dir, folder, resolution.tag)
            {
                continue;
            }
            let package_dir = [
                strings::without_trailing_slash(self.cache_directory_path.as_bytes()),
                bun_paths::SEP_STR.as_bytes(),
                folder.as_bytes(),
            ]
            .concat();
            if let Some(package) = self.describe_in(&package_dir, resolution.tag) {
                described.push((id as PackageID, package));
            }
        }
        self.adopt_described(&described);
    }
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
        Ok(())
    }
}
