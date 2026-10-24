use super::manifest::ExportsEntry;
use super::*;

impl<'h> Resolver<'h> {
    pub fn typed_version_of(&self, path: &[u8]) -> Option<TypedVersionFile<'h>> {
        let condition = self.code_options().typed_condition.as_deref()?;
        let typed_versions = &self.code_state().typed_versions;
        if let Some(&known) = typed_versions.get_ref(path) {
            return known;
        }
        let package = self.enclosing_package(path);
        let host = self.code_host();
        let from_host = |typed| (typed, TypedVersionOrigin::Host, false);
        let found = match host.typed_version(path, package) {
            Some(typed) => Some(from_host(typed)),
            None => match self.find_typed_export(path, condition) {
                Some(TypedExport::File(typed)) => Some((typed, TypedVersionOrigin::Package, false)),
                Some(TypedExport::Missing(typed)) => Some(
                    (host.installed_typed_version(path, package))
                        .map_or((typed, TypedVersionOrigin::Package, true), from_host),
                ),
                None => host.installed_typed_version(path, package).map(from_host),
            },
        };
        let typed_version = found.map(|(typed, origin, is_missing)| TypedVersionFile {
            path: self.keep(&typed),
            origin,
            is_missing,
        });
        *typed_versions.insert_ref(self.keep(path), typed_version)
    }

    fn find_typed_export(&self, path: &[u8], condition: &[u8]) -> Option<TypedExport> {
        let (manifest, exports) = self.find_package_exports(path)?;
        if !has_condition(exports, condition) {
            return None;
        }
        let orders = &self.code_options().extension_orders;
        let subpaths = candidate_subpaths(manifest, exports, path);
        let (mut missing, mut is_exported) = (None, false);
        for kind in [CodeImportKind::Import, CodeImportKind::Require] {
            let search = CodeSearch {
                kind,
                extensions: orders.for_kind(kind, true),
                uses_typed_condition: false,
            };
            let typed_search = CodeSearch {
                uses_typed_condition: true,
                ..search
            };
            for subpath in &subpaths {
                let SearchResult::File(exported) =
                    self.load_package_exports(manifest, exports, subpath, search)
                else {
                    continue;
                };
                if self.module_path(&exported) != path {
                    continue;
                }
                is_exported = true;
                let typed = self.load_package_exports(manifest, exports, subpath, typed_search);
                if matches!(typed, SearchResult::NotFound(CodeFailure::ModuleNotFound)) {
                    missing = missing.or_else(|| {
                        self.exact_exports_target(manifest, exports, subpath, typed_search)
                    });
                }
                if let Some(typed) = self.find_other_file(typed, path) {
                    return Some(TypedExport::File(typed));
                }
            }
        }
        if is_exported {
            return missing.map(TypedExport::Missing);
        }
        // What the entry points of a bundle share is a file that `exports` does not name.
        let beside = typed_path_beside(path).filter(|typed| self.code_host().is_file(typed));
        beside.map(TypedExport::File)
    }

    fn find_package_exports(
        &self,
        path: &[u8],
    ) -> Option<(&'h CodeManifest<'h>, &'h ExportsEntry<'h>)> {
        if !path.starts_with(b"/") {
            return None;
        }
        ancestors(dirname::<Posix>(path))
            .take_while(|&ancestor| strings::basename_posix(ancestor) != b"node_modules")
            .find_map(|ancestor| {
                let manifest = self.code_manifest(ancestor)?;
                Some((manifest, manifest.exports.as_ref()?))
            })
    }
}

pub const TYPED_CONDITION: &[u8] = b"full-types";
const TYPED_EXTENSIONS: [(&[u8], &[u8]); 3] = [
    (b".js", b".full.ts"),
    (b".mjs", b".full.mts"),
    (b".cjs", b".full.cts"),
];

pub fn typed_path_beside(javascript: &[u8]) -> Option<Vec<u8>> {
    TYPED_EXTENSIONS
        .iter()
        .find_map(|(from, to)| Some([javascript.strip_suffix(*from)?, *to].concat()))
}

pub fn javascript_path_beside(typed: &[u8]) -> Option<Vec<u8>> {
    TYPED_EXTENSIONS
        .iter()
        .find_map(|(to, from)| Some([typed.strip_suffix(*from)?, *to].concat()))
}

#[derive(PartialEq, Eq, Debug)]
enum TypedExport {
    File(Vec<u8>),
    Missing(Vec<u8>),
}

fn has_condition(entry: &ExportsEntry<'_>, condition: &[u8]) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    match *entry {
        ExportsEntry::Invalid | ExportsEntry::Null | ExportsEntry::Target(_) => false,
        ExportsEntry::Array(items) => items.iter().any(|item| has_condition(item, condition)),
        ExportsEntry::Map(map) => map
            .entries
            .iter()
            .any(|(key, value)| *key == condition || has_condition(value, condition)),
    }
}

fn candidate_subpaths(
    manifest: &CodeManifest<'_>,
    exports: &ExportsEntry<'_>,
    path: &[u8],
) -> Vec<Vec<u8>> {
    let mut subpaths = vec![b".".to_vec()];
    let map = match *exports {
        ExportsEntry::Map(map) => map,
        _ => return subpaths,
    };
    let keys = map.entries.iter().map(|entry| entry.0);
    let exact_keys = keys.filter(|key| {
        key.starts_with(b"./") && !key.ends_with(b"/") && !strings::contains_char(key, b'*')
    });
    subpaths.extend(exact_keys.map(<[u8]>::to_vec));
    if let Some(relative) = package_relative_path(manifest, path) {
        let expansion_keys = map.expansion_keys.iter();
        for (key, entry) in expansion_keys.filter(|entry| entry.0.starts_with(b"./")) {
            let find_subpath = |target| find_matching_subpath(key, target, &relative);
            subpaths.extend(entry.targets().into_iter().filter_map(find_subpath));
        }
    }
    let mut seen = FxHashSet::default();
    subpaths.retain(|subpath| seen.insert(subpath.clone()));
    subpaths
}

fn package_relative_path(manifest: &CodeManifest<'_>, path: &[u8]) -> Option<Vec<u8>> {
    let rest = path.strip_prefix(manifest.directory)?;
    Some(inside(b".", rest.strip_prefix(b"/").unwrap_or(rest)))
}

fn find_matching_subpath(key: &[u8], target: &[u8], relative: &[u8]) -> Option<Vec<u8>> {
    let Some(star) = strings::index_of_char_usize(key, b'*') else {
        let rest = relative.strip_prefix(target)?;
        return target.ends_with(b"/").then(|| [key, rest].concat());
    };
    let matched = match_pattern(target, relative)?;
    Some([&key[..star], matched, &key[star + 1..]].concat())
}

#[cfg(test)]
mod tests;
