//! The bodies of blob_test.bind.ts.

use crate::webcore::Blob;

pub(crate) fn store_is_all_ascii(blob: &Blob) -> Option<bool> {
    blob.store().and_then(|store| store.is_all_ascii.get())
}
