//! The recorded cases of test/js/bun/image/jpeg-golden, with the kernels for all targets. Those tests see one of them.
// They would take Miri hours.
#![cfg(not(miri))]

#[path = "../../png/tests/cases/mod.rs"]
mod cases;

use bun_core::strings;
use bun_jpeg::{Decoder, Image, encode};
use bun_zlib::inflate::Container;
use cases::*;

fn recorded() -> Vec<u8> {
    let file = include_bytes!("../../../test/js/bun/image/jpeg-golden/cases.json.gz");
    inflate(file, Container::Gzip)
}

fn summary(bytes: &[u8]) -> String {
    format!("{} bytes {}\\n", bytes.len(), &sha256(bytes)[..16])
}

fn decode(file: &[u8], eighths: u8, max_pixels: Option<u64>) -> Option<Image> {
    let decoder = Decoder::new(file).ok()?;
    let pixels = u64::from(decoder.header().width) * u64::from(decoder.header().height);
    let fits = pixels <= max_pixels.unwrap_or(0x3FFF * 0x3FFF);
    // As `Bun.Image` does: the largest of the scales that give the same size.
    let size = |eighths: u8| {
        [decoder.header().width, decoder.header().height]
            .map(|it| (it * u32::from(eighths)).div_ceil(8))
    };
    let eighths = (eighths..=8).rfind(|&it| size(it) == size(eighths))?;
    fits.then(|| decoder.decode(eighths))?.ok()
}

fn check(image: Option<Image>, name: &str, result: &str) {
    let Some(Image {
        rgba,
        width,
        height,
        icc_profile,
    }) = image
    else {
        return assert!(strings::contains(result.as_bytes(), b"ERR_"), "{name}");
    };
    let profile = icc_profile.map(|it| format!("profile {}", summary(&it)));
    let pixels = summary(&lines(&rgba, width));
    let all = format!(
        "{width} by {height}, {pixels}{}",
        profile.unwrap_or_default()
    );
    assert!(result.ends_with(&all), "{name}: {all}");
}

/// `bun_runtime` turns the image as it says.
fn has_exif(file: &[u8]) -> bool {
    strings::contains(file, b"Exif")
}

fn decodes_as_recorded() {
    let json = recorded();
    let mut cases = cases(&json, "name");
    assert_eq!(cases.len(), 973);
    cases.retain(|case| !has_exif(&case.file()));
    assert!(cases.len() > 800);
    for case in &cases {
        let image = decode(&case.file(), 8, case.number("maxPixels"));
        check(
            image,
            case.string("name").unwrap(),
            case.string("result").unwrap(),
        );
    }
}

fn scales_and_encodes_as_recorded() {
    let json = recorded();
    let (files, cases) = (files_by_name(&cases(&json, "name")), cases(&json, "source"));
    assert_eq!(cases.len(), 1290 + 229);
    for case in &cases {
        let (name, result) = (
            case.string("source").unwrap(),
            case.string("result").unwrap(),
        );
        if has_exif(&files[name]) {
            continue;
        }
        if let Some(eighths) = case.number("eighths") {
            check(decode(&files[name], eighths as u8, None), name, result);
            continue;
        }
        let Image {
            rgba,
            width,
            height,
            icc_profile,
        } = decode(&files[name], 8, None).expect(name);
        let (quality, progressive) = (
            case.number("quality").unwrap_or(80) as u8,
            case.is("progressive"),
        );
        let file = encode(
            &rgba,
            width,
            height,
            quality,
            progressive,
            icc_profile.as_deref(),
        );
        assert_eq!(
            summary(&file.expect(name)),
            result,
            "{name} {quality} {progressive}"
        );
    }
}

#[test]
fn all_is_as_recorded() {
    on_each_target(|| {
        decodes_as_recorded();
        scales_and_encodes_as_recorded();
    });
}
