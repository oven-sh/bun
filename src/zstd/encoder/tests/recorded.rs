//! What each level makes of the same input is the same on all CPUs.

#[expect(dead_code, reason = "others use the rest")]
mod common;

use bun_zstd_decoder::Result;
use bun_zstd_encoder::EndDirective::End;
use common::*;

#[test]
#[cfg_attr(miri, ignore = "takes too long")]
fn levels_write_as_recorded() -> Result<()> {
    const LEVEL: u32 = 100;
    const SEARCH_LOG: u32 = 104;
    const HASHES: [u32; 19] = [
        1659047847, 4003650332, 4031636135, 3859976542, 280858986, 1491140483, 3073891374,
        23217670, 714168435, 2683426728, 3604461177, 1449881790, 2062224363, 1616467024, 287461931,
        3827357888, 3827357888, 484203439, 1660813657,
    ];
    let (input, mut hashes) = (sample(150_000), [0; 19]);
    for (level, hash) in (1..).zip(&mut hashes) {
        let mut out = Vec::with_capacity(4 * input.len());
        for (search_log, len) in [(0, 150_000), (4, 20_000), (5, 40_000), (6, 80_000)] {
            let mut encoder = encoder(&[(LEVEL, level), (SEARCH_LOG, search_log)], &[])?;
            write(&mut encoder, &input[..len], End, usize::MAX, &mut out)?;
        }
        *hash = summary(&out).1;
    }
    assert_eq!(hashes, HASHES);
    Ok(())
}
