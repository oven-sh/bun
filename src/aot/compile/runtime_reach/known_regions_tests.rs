use super::{FileUnits, KnownFile, KnownRegions};
use bun_sema::program::FileId;
use std::sync::Arc;

fn scanned_at(version: u32) -> KnownFile {
    KnownFile {
        version,
        units: FileUnits::without_code(),
        uses: Vec::new(),
        facts: Arc::default(),
    }
}

#[test]
fn a_file_that_is_laid_again_behind_its_scan_is_known_no_more() {
    let (laid_again, laid_once) = (FileId(0), FileId(1));
    let mut known = KnownRegions::default();
    known.files.insert(laid_again, scanned_at(1));
    known.files.insert(laid_once, scanned_at(1));
    known.forget_files_laid_again(&|file| if file == laid_again { 2 } else { 1 });
    assert!(!known.files.contains_key(&laid_again));
    assert!(known.files.contains_key(&laid_once));
}
