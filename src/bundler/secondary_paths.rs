//! The dev server's stand-in for `BundleV2::scan_for_secondary_paths`: the "main" file behind each import of a "module" file.

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
    /// For an import record that the dev server resolved for a client file. The record is bound to `primary`.
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

    /// The secondary path of an import record with `HAS_SECONDARY_PATH` that is bound to `primary`.
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
