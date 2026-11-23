//! The frames have checksums. The other tests see one CPU.

use bun_simd::target::{Target, set_cpu};
use bun_zstd_decoder::{Output, Result, decompress};

#[test]
#[cfg_attr(miri, ignore = "decode.rs has the same frames")]
fn all_targets_decode() -> Result<()> {
    let all: [&[u8]; 3] = [
        include_bytes!("fixtures/generated.zst"),
        include_bytes!("fixtures/small-window.zst"),
        include_bytes!("fixtures/literals.zst"),
    ];
    for _ in Target::ALL.iter().filter(|&&target| set_cpu(target)) {
        for (frames, len) in all.into_iter().zip([122_576, 40_000, 24_000]) {
            let mut out = Vec::with_capacity(len);
            decompress(frames, &mut Output::spare_capacity(&mut out, len), None)?;
            assert_eq!(out.len(), len);
        }
    }
    Ok(())
}
