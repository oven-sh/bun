pub mod reference;
use bun_jpeg::{ColorSpace, Decoder};

pub struct Ours {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub cmyk: bool,
    pub icc: Option<Vec<u8>>,
}
#[derive(Debug)]
pub enum OurFailure {
    Header(bun_jpeg::Error),
    Decode(bun_jpeg::Error),
}
/// As in codec_jpeg.rs.
pub const MAX_SCANS: u32 = 500;

pub fn ours(bytes: &[u8], eighths: u32, max_pixels: u64) -> Result<Ours, OurFailure> {
    let d = Decoder::new(bytes).map_err(OurFailure::Header)?;
    if d.width() as u64 * d.height() as u64 > max_pixels {
        return Err(OurFailure::Header(bun_jpeg::Error::InvalidArgument));
    }
    let icc = d.icc_profile().map_err(OurFailure::Header)?;
    let cmyk = matches!(d.color_space(), ColorSpace::Cmyk | ColorSpace::Ycck);
    let scale = if d.scalable() { eighths } else { 8 };
    let (width, height) = d.scaled_size(scale);
    let options = bun_jpeg::DecodeOptions { eighths: scale, max_scans: MAX_SCANS };
    let pixels = d.decode(&options).map_err(OurFailure::Decode)?;
    Ok(Ours { pixels, width, height, cmyk, icc })
}

/// Returns a description of the first difference.
pub fn compare(bytes: &[u8], eighths: u32, max_pixels: u64) -> Result<&'static str, String> {
    let r = reference::decode(bytes, eighths, max_pixels);
    let o = ours(bytes, eighths, max_pixels);
    if let Err(OurFailure::Header(bun_jpeg::Error::Internal) | OurFailure::Decode(bun_jpeg::Error::Internal)) = o {
        return Err("ours failed with Error::Internal, which no input should get to".into());
    }
    match (r, o) {
        // On purpose: libjpeg-turbo decodes such a scan.
        (Ok(_), Err(OurFailure::Decode(bun_jpeg::Error::RedundantScan))) => Ok("redundant-scan"),
        (Err(reference::Failure::Header(_)), Err(OurFailure::Header(_))) => Ok("header-fail"),
        (Err(reference::Failure::Decode(_)), Err(OurFailure::Decode(_))) => Ok("decode-fail"),
        (Err(r), Err(o)) => Err(format!("failed at different stages: ref {r:?}, ours {o:?}")),
        (Err(r), Ok(_)) => Err(format!("ref failed ({r:?}), ours succeeded")),
        (Ok(r), Err(o)) => Err(format!("ref succeeded (warn: {:?}), ours failed: {o:?}", r.last_message)),
        (Ok(r), Ok(o)) => {
            if (r.width, r.height, r.cmyk) != (o.width, o.height, o.cmyk) {
                return Err(format!("shape: ref {}x{} cmyk={}, ours {}x{} cmyk={}", r.width, r.height, r.cmyk, o.width, o.height, o.cmyk));
            }
            if r.icc != o.icc {
                return Err(format!("icc: ref {:?}, ours {:?}", r.icc.map(|v| v.len()), o.icc.map(|v| v.len())));
            }
            if r.pixels != o.pixels {
                let i = r.pixels.iter().zip(&o.pixels).position(|(a, b)| a != b).unwrap();
                let n = r.pixels.iter().zip(&o.pixels).filter(|(a, b)| a != b).count();
                let px = i / 4;
                return Err(format!(
                    "pixels: {n} bytes differ, first at x={} y={} c={}: ref {} ours {} ({}x{})",
                    px as u32 % r.width, px as u32 / r.width, i % 4, r.pixels[i], o.pixels[i], r.width, r.height
                ));
            }
            Ok(if r.decode_warned { "ok-warned" } else { "ok" })
        }
    }
}
