//! Writing the RIFF container (`syntax_enc.c`, `vp8l_enc.c` and, for a profile, `mux/`).

use crate::EncodeError;
use crate::riff::{
    ALPHA_FLAG, CHUNK_HEADER_SIZE, ICCP_FLAG, MAX_CHUNK_PAYLOAD, RIFF_HEADER_SIZE, TAG_SIZE,
    VP8X_CHUNK_SIZE,
};
use crate::util::OutOfMemory;

/// What the encoders return.
pub(crate) struct Image {
    pub(crate) width: usize,
    pub(crate) height: usize,
    /// The payload of the `VP8 ` or `VP8L` chunk.
    pub(crate) bitstream: Vec<u8>,
    pub(crate) is_lossless: bool,
    /// Lossy: the payload of the `ALPH` chunk.
    pub(crate) alpha: Option<Vec<u8>>,
    /// Lossless: the bitstream says that it has alpha.
    pub(crate) lossless_has_alpha: bool,
}

fn disk_size(payload: &[u8]) -> Result<u64, EncodeError> {
    if payload.len() > MAX_CHUNK_PAYLOAD as usize {
        return Err(EncodeError::FileTooBig);
    }
    Ok((CHUNK_HEADER_SIZE as u64 + payload.len() as u64 + 1) & !1)
}

fn put_chunk(out: &mut Vec<u8>, tag: [u8; TAG_SIZE], payload: &[u8]) {
    out.extend_from_slice(&tag);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    if payload.len() & 1 != 0 {
        out.push(0);
    }
}

pub(crate) fn assemble(image: &Image, icc_profile: Option<&[u8]>) -> Result<Vec<u8>, EncodeError> {
    let icc_profile = icc_profile.filter(|profile| !profile.is_empty());
    let alpha = image.alpha.as_deref();
    let mut flags = 0;
    if icc_profile.is_some() {
        flags |= ICCP_FLAG;
    }
    // A lossless image says so itself, and only repeats it in a VP8X chunk that something else calls for.
    if alpha.is_some() || (flags != 0 && image.lossless_has_alpha) {
        flags |= ALPHA_FLAG;
    }

    let mut size = RIFF_HEADER_SIZE as u64 + disk_size(&image.bitstream)?;
    if flags != 0 {
        size += (CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE) as u64;
    }
    if let Some(profile) = icc_profile {
        size += disk_size(profile)?;
    }
    if let Some(alpha) = alpha {
        size += disk_size(alpha)?;
    }
    let riff_size = size - CHUNK_HEADER_SIZE as u64;
    if riff_size > 0xffff_fffe {
        return Err(EncodeError::FileTooBig);
    }

    let mut out = Vec::new();
    out.try_reserve_exact(size as usize)
        .map_err(|_| OutOfMemory)?;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff_size as u32).to_le_bytes());
    out.extend_from_slice(b"WEBP");
    if flags != 0 {
        let [w0, w1, w2, _] = (image.width as u32 - 1).to_le_bytes();
        let [h0, h1, h2, _] = (image.height as u32 - 1).to_le_bytes();
        let [f0, f1, f2, f3] = flags.to_le_bytes();
        put_chunk(
            &mut out,
            *b"VP8X",
            &[f0, f1, f2, f3, w0, w1, w2, h0, h1, h2],
        );
    }
    if let Some(profile) = icc_profile {
        put_chunk(&mut out, *b"ICCP", profile);
    }
    if let Some(alpha) = alpha {
        put_chunk(&mut out, *b"ALPH", alpha);
    }
    put_chunk(
        &mut out,
        if image.is_lossless {
            *b"VP8L"
        } else {
            *b"VP8 "
        },
        &image.bitstream,
    );
    Ok(out)
}
