use bun_paths::strings;

use crate::dir_info::DirInfo;
use crate::package_json::{ESModule, Status};
use crate::resolver::Resolver;
use crate::tsconfig_json::TSConfigJSON;

bun_js_parser::link_impl_ImportMetaGlobHost! {
    Resolver for Resolver<'static> => |this| {
        resolve_alias(importer_dir, glob) => (*this).import_meta_glob_alias(importer_dir, glob),
        did_scan(scan) => drop(scan),
    }
}

/// A directory, and a pattern relative to it.
type GlobInDir = (Vec<u8>, Vec<u8>);

impl Resolver<'_> {
    /// Where a pattern such as `@/pages/*.tsx` or `#pages/*.tsx` is, in the order that an import
    /// path is looked up in.
    pub fn import_meta_glob_alias(
        &mut self,
        importer_dir: &[u8],
        glob: &[u8],
    ) -> Option<GlobInDir> {
        let dir_info = self.read_dir_info_ignore_error(importer_dir)?;
        let tsconfig = self.enclosing_tsconfig_json(&dir_info);
        if let Some(tsconfig) = &tsconfig
            && let Some(found) = self.import_meta_glob_in_tsconfig_paths(tsconfig, glob)
        {
            return Some(found);
        }
        if glob.starts_with(b"#")
            && let Some(found) = self.import_meta_glob_in_package_imports(&dir_info, glob)
        {
            return Some(found);
        }
        let tsconfig = tsconfig?;
        tsconfig
            .has_base_url()
            .then(|| (tsconfig.base_url.to_vec(), glob.to_vec()))
    }

    /// Only the first substitution is used, as in Vite.
    fn import_meta_glob_in_tsconfig_paths(
        &mut self,
        tsconfig: &TSConfigJSON,
        glob: &[u8],
    ) -> Option<GlobInDir> {
        let paths = &tsconfig.paths;
        let (original_paths, matched_text): (&[Box<[u8]>], &[u8]) =
            if let Some(exact) = paths.keys().iter().position(|key| **key == *glob) {
                (&paths.values()[exact], b"")
            } else {
                let wildcard = tsconfig.match_paths_wildcard(glob)?;
                (
                    wildcard.original_paths,
                    &glob[wildcard.prefix.len()..glob.len() - wildcard.suffix.len()],
                )
            };
        let original_path = original_paths
            .iter()
            .find(|original_path| !self.is_type_only_tsconfig_path(original_path))?;

        let (before, after) =
            strings::split_once_char(original_path, b'*').unwrap_or((original_path, b""));
        let name_start = strings::last_index_of_any(before, b"/\\").map_or(0, |slash| slash + 1);
        let mut buf = bun_paths::path_buffer_pool::get();
        let dir = self.fs_ref().abs_buf_checked(
            &[tsconfig.abs_base_url_for_paths(), &before[..name_start]],
            &mut buf[..],
        )?;
        Some((
            dir.to_vec(),
            [&before[name_start..], matched_text, after].concat(),
        ))
    }

    fn import_meta_glob_in_package_imports(
        &self,
        dir_info: &DirInfo,
        glob: &[u8],
    ) -> Option<GlobInDir> {
        let package_json = dir_info.package_json_for_module_type?;
        let resolution = ESModule {
            conditions: &self.opts.conditions.import,
            debug_logs: None,
        }
        .resolve_imports(glob, &package_json.imports.as_ref()?.root);
        matches!(
            resolution.status,
            Status::Exact | Status::ExactEndsWithStar | Status::Inexact
        )
        .then(|| {
            (
                package_json.source.path.name().dir.to_vec(),
                strings::without_leading_path_separator(&resolution.path).to_vec(),
            )
        })
    }
}
