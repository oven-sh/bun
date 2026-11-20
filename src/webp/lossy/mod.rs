//! VP8 key frames: https://datatracker.ietf.org/doc/html/rfc6386

pub(crate) mod decoder;
pub(crate) mod encoder;
mod tables;

const SIGNATURE: [u8; 3] = [0x9d, 0x01, 0x2a];
const FRAME_HEADER_LEN: usize = 10;

const SEGMENTS: usize = 4;
const SUBBLOCK_MODES: usize = 10;

/// By `BlockType`, band, context and position in the tree of tokens.
type CoefficientProbabilities = [[[[u8; 11]; 3]; 8]; 4];

/// What the coefficients of a block of 4x4 are for.
#[derive(Clone, Copy)]
enum BlockType {
    /// Luma whose first coefficient is in the `Y2` block.
    LumaWithoutDc = 0,
    Y2 = 1,
    Chroma = 2,
    LumaWithDc = 3,
}

/// How all of a macroblock's luma, or its chroma, is predicted.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MacroblockMode {
    Dc = 0,
    TrueMotion = 1,
    Vertical = 2,
    Horizontal = 3,
}

/// How 4x4 samples of luma are predicted.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SubblockMode {
    Dc = 0,
    TrueMotion = 1,
    Vertical = 2,
    Horizontal = 3,
    RightDown = 4,
    VerticalRight = 5,
    LeftDown = 6,
    VerticalLeft = 7,
    HorizontalDown = 8,
    HorizontalUp = 9,
}

impl From<MacroblockMode> for SubblockMode {
    /// What counts as the mode of each subblock of a macroblock that is predicted as a whole.
    fn from(mode: MacroblockMode) -> Self {
        match mode {
            MacroblockMode::Dc => Self::Dc,
            MacroblockMode::TrueMotion => Self::TrueMotion,
            MacroblockMode::Vertical => Self::Vertical,
            MacroblockMode::Horizontal => Self::Horizontal,
        }
    }
}
