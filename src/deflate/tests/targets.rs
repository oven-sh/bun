//! All CPUs write the same, and read it. The other tests see one of them.

use bun_deflate::{Format, Level, Output, Result, compress_to_vec, gunzip};
use bun_simd::target::{Target, set_cpu};

#[test]
#[cfg_attr(miri, ignore = "takes too long")]
fn all_targets_agree() -> Result<()> {
    let text = include_bytes!("compress.rs");
    for level in (0..).map_while(Level::new) {
        for input in [&text[..40], &text[..900], text] {
            let mut first = None;
            for _ in Target::ALL.iter().filter(|&&target| set_cpu(target)) {
                let (gzip, limit) = (compress_to_vec(input, Format::Gzip, level)?, input.len());
                let vec = &mut Vec::new();
                gunzip(&gzip, Output::Vec { vec, limit })?;
                assert!(vec == input && *first.get_or_insert_with(|| gzip.clone()) == gzip);
            }
        }
    }
    Ok(())
}
