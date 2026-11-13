use super::*;

const PAGE_SIZE: usize = 512;

/// A log of one frame, page `number`, that commits `page_count` pages.
fn make_log(number: u32, page_count: u32) -> Vec<u8> {
    let mut checksum = Checksum {
        sums: (0, 0),
        is_big_endian: true,
    };
    let sums = |checksum: &Checksum| {
        [checksum.sums.0.to_be_bytes(), checksum.sums.1.to_be_bytes()].concat()
    };
    let words = [0x377f_0683, 3_007_000, PAGE_SIZE as u32, 0, 1, 2];
    let mut log = words.map(u32::to_be_bytes).concat();
    checksum.add(&log);
    log.extend(sums(&checksum));
    let frame = [number, page_count, 1, 2].map(u32::to_be_bytes).concat();
    let page = [b'n'; PAGE_SIZE];
    checksum.add(&frame[..8]);
    checksum.add(&page);
    [log, frame, sums(&checksum), page.to_vec()].concat()
}

#[test]
fn commit_has_no_more_pages_than_there_are() {
    let database = [b'o'; 2 * PAGE_SIZE];
    let (old, new) = ([b'o'; PAGE_SIZE], [b'n'; PAGE_SIZE]);
    assert_eq!(
        apply_log(&database, &make_log(2, 2)),
        Some([old, new].concat())
    );
    assert_eq!(
        apply_log(&database, &make_log(3, 3)),
        Some([old, old, new].concat())
    );
    assert_eq!(apply_log(&database, &make_log(1, 1)), Some(new.to_vec()));
    for page_count in [4, 1 << 20, u32::MAX] {
        assert_eq!(apply_log(&database, &make_log(2, page_count)), None);
    }
}
