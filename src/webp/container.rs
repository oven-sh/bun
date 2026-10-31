//! Writing the RIFF container (`syntax_enc.c`, `vp8l_enc.c` and, for a profile, `mux/`).

use core::slice::from_ref;

use crate::riff::{
    ALPHA_FLAG, CHUNK_HEADER_SIZE, ICCP_FLAG, MAX_CHUNK_PAYLOAD, RIFF_HEADER_SIZE, TAG_SIZE,
    VP8X_CHUNK_SIZE, padded,
};
use crate::util::try_with_capacity;
use crate::vp8::common::FRAME_HEADER_SIZE;
use crate::{Error, Info, Result};

/// The largest even number that fits the size field of the RIFF header.
const MAX_RIFF_SIZE: u64 = 0xffff_fffe;

/// What the encoders return.
pub(crate) enum Bitstream {
    Lossy {
        header: [u8; FRAME_HEADER_SIZE],
        partition0: Vec<u8>,
        /// The token partition, and what pads the three pieces to an even size.
        tokens: Vec<u8>,
        /// The payload of the `ALPH` chunk.
        alpha: Option<Vec<u8>>,
    },
    Lossless {
        data: Vec<u8>,
        /// What `data` says about itself.
        has_alpha: bool,
    },
}

impl Bitstream {
    fn tag(&self) -> &'static [u8; TAG_SIZE] {
        match self {
            Self::Lossy { .. } => b"VP8 ",
            Self::Lossless { .. } => b"VP8L",
        }
    }

    /// The payload of the chunk.
    fn pieces(&self) -> [&[u8]; 3] {
        match self {
            Self::Lossy {
                header,
                partition0,
                tokens,
                ..
            } => [header, partition0, tokens],
            Self::Lossless { data, .. } => [data, &[], &[]],
        }
    }
}

/// A chunk whose payload is in pieces.
struct Chunk<'a> {
    tag: &'static [u8; TAG_SIZE],
    payload: &'a [&'a [u8]],
}

impl Chunk<'_> {
    fn payload_size(&self) -> Result<u32> {
        let size: u64 = self.payload.iter().map(|piece| piece.len() as u64).sum();
        if size > u64::from(MAX_CHUNK_PAYLOAD) {
            return Err(Error::FileTooBig);
        }
        Ok(size as u32)
    }

    fn disk_size(&self) -> Result<u64> {
        Ok(CHUNK_HEADER_SIZE as u64 + u64::from(padded(self.payload_size()?)))
    }

    /// `out` has room for `disk_size` bytes.
    fn put(&self, out: &mut Vec<u8>) -> Result<()> {
        let size = self.payload_size()?;
        out.extend_from_slice(self.tag);
        out.extend_from_slice(&size.to_le_bytes());
        for piece in self.payload {
            out.extend_from_slice(piece);
        }
        if padded(size) != size {
            out.push(0);
        }
        Ok(())
    }
}

/// The file of an image of the size `canvas`, which is not empty.
pub(crate) fn assemble(
    canvas: Info,
    bitstream: &Bitstream,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let icc_profile = icc_profile.filter(|profile| !profile.is_empty());
    // A lossless image says itself whether it has alpha. A VP8X chunk repeats it if something else calls for one.
    let (alpha, has_alpha) = match bitstream {
        Bitstream::Lossy { alpha, .. } => (alpha.as_deref(), alpha.is_some()),
        Bitstream::Lossless { has_alpha, .. } => (None, *has_alpha && icc_profile.is_some()),
    };
    let mut flags = 0;
    if icc_profile.is_some() {
        flags |= ICCP_FLAG;
    }
    if has_alpha {
        flags |= ALPHA_FLAG;
    }
    let [w0, w1, w2, _] = (canvas.width - 1).to_le_bytes();
    let [h0, h1, h2, _] = (canvas.height - 1).to_le_bytes();
    let [f0, f1, f2, f3] = flags.to_le_bytes();
    let vp8x: [u8; VP8X_CHUNK_SIZE] = [f0, f1, f2, f3, w0, w1, w2, h0, h1, h2];
    let vp8x = (flags != 0).then_some(vp8x.as_slice());

    let pieces = bitstream.pieces();
    let chunks = [
        vp8x.as_ref().map(|vp8x| Chunk {
            tag: b"VP8X",
            payload: from_ref(vp8x),
        }),
        icc_profile.as_ref().map(|profile| Chunk {
            tag: b"ICCP",
            payload: from_ref(profile),
        }),
        alpha.as_ref().map(|alpha| Chunk {
            tag: b"ALPH",
            payload: from_ref(alpha),
        }),
        Some(Chunk {
            tag: bitstream.tag(),
            payload: &pieces,
        }),
    ];

    let mut size = RIFF_HEADER_SIZE as u64;
    for chunk in chunks.iter().flatten() {
        size += chunk.disk_size()?;
    }
    let riff_size = size - CHUNK_HEADER_SIZE as u64;
    if riff_size > MAX_RIFF_SIZE {
        return Err(Error::FileTooBig);
    }

    let mut out = try_with_capacity(size as usize)?;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff_size as u32).to_le_bytes());
    out.extend_from_slice(b"WEBP");
    for chunk in chunks.iter().flatten() {
        chunk.put(&mut out)?;
    }
    Ok(out)
}
