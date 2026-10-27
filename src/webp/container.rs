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
    /// The payload of the `VP8 ` or `VP8L` chunk, in pieces.
    pub(crate) bitstream: Vec<Vec<u8>>,
    pub(crate) is_lossless: bool,
    /// Lossy: the payload of the `ALPH` chunk.
    pub(crate) alpha: Option<Vec<u8>>,
    /// Lossless: the bitstream says that it has alpha.
    pub(crate) lossless_has_alpha: bool,
}

/// A chunk whose payload is in pieces.
struct Chunk<'a, T> {
    tag: [u8; TAG_SIZE],
    payload: &'a [T],
}

impl<T: AsRef<[u8]>> Chunk<'_, T> {
    fn payload_size(&self) -> u64 {
        self.payload
            .iter()
            .map(|piece| piece.as_ref().len() as u64)
            .sum()
    }

    fn disk_size(&self) -> Result<u64, EncodeError> {
        let size = self.payload_size();
        if size > u64::from(MAX_CHUNK_PAYLOAD) {
            return Err(EncodeError::FileTooBig);
        }
        Ok((CHUNK_HEADER_SIZE as u64 + size + 1) & !1)
    }

    /// `out` has room for `disk_size` bytes.
    fn put(&self, out: &mut Vec<u8>) {
        let size = self.payload_size();
        out.extend_from_slice(&self.tag);
        out.extend_from_slice(&(size as u32).to_le_bytes());
        for piece in self.payload {
            out.extend_from_slice(piece.as_ref());
        }
        if size & 1 != 0 {
            out.push(0);
        }
    }
}

pub(crate) fn assemble(image: &Image, icc_profile: Option<&[u8]>) -> Result<Vec<u8>, EncodeError> {
    let icc_profile = icc_profile.filter(|profile| !profile.is_empty());
    let mut flags = 0;
    if icc_profile.is_some() {
        flags |= ICCP_FLAG;
    }
    // A lossless image says so itself, and only repeats it in a VP8X chunk that something else calls for.
    if image.alpha.is_some() || (flags != 0 && image.lossless_has_alpha) {
        flags |= ALPHA_FLAG;
    }
    let [w0, w1, w2, _] = (image.width as u32 - 1).to_le_bytes();
    let [h0, h1, h2, _] = (image.height as u32 - 1).to_le_bytes();
    let [f0, f1, f2, f3] = flags.to_le_bytes();
    let vp8x: [u8; VP8X_CHUNK_SIZE] = [f0, f1, f2, f3, w0, w1, w2, h0, h1, h2];

    let one_piece = |tag: &[u8; TAG_SIZE], payload| Chunk { tag: *tag, payload };
    let vp8x = [vp8x.as_slice()];
    let icc_profile = icc_profile.map(|profile| [profile]);
    let alpha = image.alpha.as_deref().map(|alpha| [alpha]);
    let before = [
        (flags != 0).then(|| one_piece(b"VP8X", vp8x.as_slice())),
        icc_profile
            .as_ref()
            .map(|profile| one_piece(b"ICCP", profile.as_slice())),
        alpha
            .as_ref()
            .map(|alpha| one_piece(b"ALPH", alpha.as_slice())),
    ];
    let bitstream = Chunk {
        tag: if image.is_lossless {
            *b"VP8L"
        } else {
            *b"VP8 "
        },
        payload: image.bitstream.as_slice(),
    };

    let mut size = RIFF_HEADER_SIZE as u64 + bitstream.disk_size()?;
    for chunk in before.iter().flatten() {
        size += chunk.disk_size()?;
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
    for chunk in before.iter().flatten() {
        chunk.put(&mut out);
    }
    bitstream.put(&mut out);
    Ok(out)
}
