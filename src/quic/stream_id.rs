//! RFC 9000 §2.1.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Client,
    Server,
}

impl Side {
    #[inline]
    pub fn is_client(self) -> bool {
        self == Self::Client
    }

    #[inline]
    pub fn is_server(self) -> bool {
        self == Self::Server
    }
}

impl core::ops::Not for Side {
    type Output = Self;

    #[inline]
    fn not(self) -> Self {
        match self {
            Self::Client => Self::Server,
            Self::Server => Self::Client,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Bidirectional,
    Unidirectional,
}

impl Direction {
    #[inline]
    pub(crate) fn from_bit(bit: u64) -> Self {
        match bit {
            0 => Self::Bidirectional,
            _ => Self::Unidirectional,
        }
    }
}

#[repr(transparent)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct StreamId(pub u64);

impl StreamId {
    #[inline]
    pub(crate) fn new(initiator: Side, direction: Direction, index: u64) -> Self {
        Self(index << 2 | (direction as u64) << 1 | initiator as u64)
    }

    #[inline]
    pub(crate) fn initiator(self) -> Side {
        match self.0 & 1 {
            0 => Side::Client,
            _ => Side::Server,
        }
    }

    #[inline]
    pub fn direction(self) -> Direction {
        Direction::from_bit(self.0 & 2)
    }

    /// How many streams of this type come before it.
    #[inline]
    pub(crate) fn index(self) -> u64 {
        self.0 >> 2
    }
}
