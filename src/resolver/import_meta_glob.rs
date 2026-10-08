use bun_paths::strings;

use crate::package_json::{ESModule, Status};
use crate::resolver::Resolver;

bun_js_parser::link_impl_ImportMetaGlobResolver! {
    Resolver for Resolver<'static> => |this| {
        resolve_alias(importer_dir, glob) => (*this).resolve_import_meta_glob_alias(importer_dir, glob),
    }
}

impl Resolver<'_> {
    /// A pattern such as `@/pages/*.tsx` or `#pages/*.tsx`, through tsconfig.json's "paths" and
    /// "baseUrl" and package.json's "imports": the directory they map it into, and the pattern from there.
    fn resolve_import_meta_glob_alias(
        &mut self,
        importer_dir: &[u8],
        glob: &[u8],
    ) -> Option<(Vec<u8>, Vec<u8>)> {
        let dir_info = self.read_dir_info_ignore_error(importer_dir)?;
        let package_import = || {
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
        };
        let package_import = glob.starts_with(b"#").then(package_import).flatten();
        let Some(tsconfig) = self.enclosing_tsconfig_json(&dir_info) else {
            return package_import;
        };

        let (original_paths, matched_text): (&[Box<[u8]>], &[u8]) =
            if let Some(exact) = tsconfig.paths.keys().iter().position(|key| **key == *glob) {
                (&tsconfig.paths.values()[exact], b"")
            } else if let Some(wildcard) = tsconfig.match_paths_wildcard(glob) {
                (
                    wildcard.original_paths,
                    &glob[wildcard.prefix.len()..glob.len() - wildcard.suffix.len()],
                )
            } else {
                (&[], b"")
            };
        let Some(original_path) = original_paths
            .iter()
            .find(|original_path| !self.is_type_only_tsconfig_path(original_path))
        else {
            return package_import.or_else(|| {
                tsconfig
                    .has_base_url()
                    .then(|| (tsconfig.base_url.to_vec(), glob.to_vec()))
            });
        };

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
}
