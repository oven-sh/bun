//! The recorded cases of test/js/bun/image/png-golden, with the kernels for all targets. Those tests see one of them.

mod cases;

use bun_png::{Decoder, Image, encode};
use bun_zlib::{deflate, inflate::Container};
use cases::*;

macro_rules! recorded {
    ($name:literal) => {
        inflate(
            include_bytes!(concat!("../../../test/js/bun/image/png-golden/", $name)),
            Container::Gzip,
        )
    };
}

fn decode(file: &[u8], max_pixels: Option<u64>) -> Option<(u32, u32, Image)> {
    let decoder = Decoder::new(file).ok()?;
    let (width, height) = (decoder.header().width, decoder.header().height);
    let fits = u64::from(width) * u64::from(height) <= max_pixels.unwrap_or(0x3FFF * 0x3FFF);
    Some((width, height, fits.then(|| decoder.decode())?.ok()?))
}

fn decodes_as_recorded() {
    let json = recorded!("cases.json.gz");
    let cases = cases(&json, "name");
    assert_eq!(cases.len(), 1097);
    for case in &cases {
        let (name, result) = (case.string("name").unwrap(), case.string("result").unwrap());
        let Some((width, _, image)) = decode(&case.file(), case.number("maxPixels")) else {
            assert!(result.starts_with("ERR_"), "{name}");
            continue;
        };
        let lines = lines(&image.rgba, width);
        let summary = format!("IDAT {} bytes {}\\n", lines.len(), sha256(&lines));
        assert!(result.ends_with(&summary), "{name}");
    }
}

fn decodes_valid_files() {
    for (json, count) in [
        (recorded!("valid.json.gz"), 622),
        (recorded!("generated.json.gz"), 627),
    ] {
        let cases = cases(&json, "name");
        assert_eq!(cases.len(), count);
        for case in &cases {
            let name = case.string("name").unwrap();
            let (width, _, image) = decode(&case.file(), case.number("maxPixels")).expect(name);
            let profile = image.icc_profile.as_deref().map(sha256);
            assert_eq!(
                case.string("sha256").unwrap(),
                sha256(&lines(&image.rgba, width)),
                "{name}"
            );
            assert_eq!(case.string("profile"), profile.as_deref(), "{name}");
        }
    }
}

fn encodes_as_recorded() {
    let json = recorded!("cases.json.gz");
    let (files, mut cases) = (files_by_name(&cases(&json, "name")), cases(&json, "source"));
    // The quantizer is in bun_runtime.
    cases.retain(|case| !case.is("palette"));
    assert!(cases.len() > 100);
    for case in &cases {
        let name = case.string("source").unwrap();
        let (width, height, image) = decode(&files[name], None).expect(name);
        let level = case
            .number("compressionLevel")
            .map_or(-1, |level| level as i8);
        let file = encode(
            &image.rgba,
            width,
            height,
            None,
            level,
            image.icc_profile.as_deref(),
        )
        .expect(name);
        let summary = format!("file {} bytes {}\\n", file.len(), sha256(&file));
        assert!(
            case.string("result").unwrap().ends_with(&summary),
            "{name} {level}"
        );
    }
}

/// The recorded files have few rows that are long enough to be unfiltered side by side.
fn decodes_long_rows() {
    let mut state = 1u32;
    let mut random = move || {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        (state >> 24) as u8
    };
    for (color_type, picked) in [
        (0, [0, 0, 0, 9]),
        (2, [0, 1, 2, 9]),
        (4, [0, 0, 0, 1]),
        (6, [0, 1, 2, 3]),
    ] {
        for (bytes, width, height) in (60..76).map(|it| (1 + it / 4 % 2, it, 4 * it - 230 - it % 3))
        {
            let step = bytes * [1, 3, 2, 4][usize::from(color_type / 2)];
            // Black is transparent, and frequent.
            let has_key = width % 2 == 0 && color_type < 4;
            let (mut above, mut lines, mut rgba) = (vec![0; (1 + width) * step], vec![], vec![]);
            for _ in 0..height {
                let (filter_type, mut row) = ((random() % 16).min(4), vec![0; step]);
                lines.push(filter_type);
                for at in 0..width * step {
                    let [a, b, c] = [row[at], above[at + step], above[at]].map(i32::from);
                    let nearest = [a, b, c]
                        .into_iter()
                        .min_by_key(|it| (a + b - c - it).abs());
                    let predicted =
                        [0, a, b, (a + b) / 2, nearest.unwrap()][usize::from(filter_type)];
                    row.push(random() & if has_key { 128 } else { 255 });
                    lines.push(row[at + step].wrapping_sub(predicted as u8));
                }
                for pixel in row.chunks(step).skip(1) {
                    let is_clear = has_key && pixel.iter().all(|&it| it == 0);
                    let alpha = if is_clear { 0 } else { 255 };
                    rgba.extend(picked.map(|it| *pixel.get(it * bytes).unwrap_or(&alpha)));
                }
                above = row;
            }
            let mut idat = b"IDAT".to_vec();
            deflate::compress(
                &lines,
                &mut idat,
                deflate::Container::Zlib,
                Default::default(),
            )
            .unwrap();
            let (width, height, depth) = (width as u8, height as u8, 8 * bytes as u8);
            let header = [0, 0, 0, width, 0, 0, 0, height, depth, color_type, 0, 0, 0];
            let mut file = b"\x89PNG\r\n\x1a\n".to_vec();
            let header = [&b"IHDR"[..], &header].concat();
            let mut key = if has_key { b"tRNS" } else { b"skIp" }.to_vec();
            key.resize(4 + 2 * step / bytes, 0);
            for chunk in [&header[..], &key, &idat, b"IEND"] {
                file.extend((chunk.len() as u32 - 4).to_be_bytes());
                file.extend(chunk);
                file.extend(bun_hash::crc32(0, chunk).to_be_bytes());
            }
            let decoded = decode(&file, None).unwrap().2.rgba;
            assert!(decoded == rgba, "{color_type} {width}");
        }
    }
}

#[test]
fn all_is_as_recorded() {
    on_each_target(|| {
        decodes_as_recorded();
        decodes_valid_files();
        encodes_as_recorded();
        decodes_long_rows();
    });
}
