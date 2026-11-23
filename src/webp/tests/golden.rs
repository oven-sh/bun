//! The recorded files of test/js/bun/image/webp-golden, with the kernels for all targets. Those tests see one of them.

#[path = "../../png/tests/cases/mod.rs"]
#[expect(dead_code, reason = "others use the rest")]
mod cases;

use bun_core::strings;
use bun_webp::Decoder;
use bun_zlib::inflate::Container;
use cases::*;

fn summary(file: &[u8]) -> Option<String> {
    let decoder = Decoder::new(file).ok()?;
    let (width, height) = (decoder.width(), decoder.height());
    let fits = u64::from(width) * u64::from(height) <= 1 << 25;
    let lines = lines(&fits.then(|| decoder.decode())?.ok()?.rgba, width);
    Some(format!("{width}x{height} {}", &sha256(&lines)[..20]))
}

#[test]
fn decodes_as_recorded() {
    let json = include_bytes!("../../../test/js/bun/image/webp-golden/cases.json.gz");
    let json = inflate(json, Container::Gzip);
    let mut cases = cases(&json, "name");
    cases.retain(|case| case.string("data").is_some());
    assert_eq!(cases.len(), 361);
    on_each_target(|| {
        for case in &cases {
            let (name, result) = (case.string("name").unwrap(), case.string("result").unwrap());
            let found = summary(&case.file()).unwrap_or_else(|| "ERR_".into());
            assert!(
                strings::contains(result.as_bytes(), found.as_bytes()),
                "{name}"
            );
        }
    });
}
