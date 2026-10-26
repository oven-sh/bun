//! An `import` of a package with a "module" and a "main" field resolves to the
//! "module" file, the primary path. The "main" file is its secondary path. When
//! a file of the build names the "main" file itself, most often through
//! `require()`, `BundleV2::scan_for_secondary_paths` binds every import of the
//! "module" file to the "main" file. The output then has one copy of the package.
//!
//! The dev server prints each file alone, so it does not run that pass. It
//! keeps the secondary paths of a bundle, and decides for each route when it
//! builds the page of that route (`DevServer::trace_all_route_imports`).

use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_collections::StringHashMap;

use crate::bun_fs as Fs;
use crate::bundle_v2::BundleV2;

/// The secondary paths of a dev server bundle, by primary path.
#[derive(Default)]
pub struct SecondaryPaths {
    by_primary: StringHashMap<&'static [u8]>,
}

impl SecondaryPaths {
    /// Called for an import record of a client file that the dev server
    /// resolved. `primary` is the path that the record is bound to.
    #[inline]
    pub(crate) fn note(
        &mut self,
        record: &mut ImportRecord,
        resolved: &bun_resolver::Result,
        primary: &Fs::Path<'_>,
    ) {
        let Some(secondary) = &resolved.path_pair.secondary else {
            return;
        };
        if secondary.is_disabled || bun_core::strings::eql_long(secondary.text, primary.text, true)
        {
            return;
        }
        record.flags.insert(ImportRecordFlags::HAS_SECONDARY_PATH);
        bun_core::handle_oom(self.by_primary.put(primary.text, secondary.text));
    }

    /// The secondary path of an import record with `HAS_SECONDARY_PATH` that
    /// is bound to `primary`. Both are keys of the dev server's graph.
    pub fn get(&self, primary: &[u8]) -> Option<&'static [u8]> {
        self.by_primary.get(primary).copied()
    }

    /// Each primary path of `get` with its secondary path.
    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &'static [u8])> {
        self.by_primary
            .iter()
            .map(|(primary, secondary)| (&**primary, *secondary))
    }
}

impl<'a> BundleV2<'a> {
    pub fn dev_server_secondary_paths(&self) -> &SecondaryPaths {
        &self.dev_secondary_paths
    }
}
