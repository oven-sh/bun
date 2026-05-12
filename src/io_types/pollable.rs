use core::num::NonZeroUsize;

use crate::owner::OwnerToken;

#[repr(u16)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Empty = 0,
    ReadFile = 1,
    WriteFile = 2,
}

pub trait Variant {
    const KIND: Kind;
}

pub enum ReadFile {}
pub enum WriteFile {}

impl Variant for ReadFile {
    const KIND: Kind = Kind::ReadFile;
}

impl Variant for WriteFile {
    const KIND: Kind = Kind::WriteFile;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token(u64);

pub const ADDR_BITS: u32 = 49;
pub const ADDR_MASK: u64 = (1u64 << ADDR_BITS) - 1;

impl Token {
    #[inline]
    pub fn encode<T: Variant>(poll: OwnerToken<T>) -> Self {
        let addr = poll.get() as u64;
        debug_assert_eq!(addr & !ADDR_MASK, 0);
        Self((addr & ADDR_MASK) | ((T::KIND as u64) << ADDR_BITS))
    }

    #[inline]
    pub const fn from_raw(raw: u64) -> Self {
        Self(raw)
    }

    #[inline]
    pub const fn as_u64(self) -> u64 {
        self.0
    }

    #[inline]
    pub const fn owner_addr(self) -> usize {
        (self.0 & ADDR_MASK) as usize
    }

    #[inline]
    pub fn kind_checked(self) -> Option<Kind> {
        match (self.0 >> ADDR_BITS) as u16 {
            0 => Some(Kind::Empty),
            1 => Some(Kind::ReadFile),
            2 => Some(Kind::WriteFile),
            _ => None,
        }
    }

    #[inline]
    pub fn decode(self) -> Owner {
        let Some(id) = NonZeroUsize::new(self.owner_addr()) else {
            return Owner::Empty;
        };

        match self.kind_checked() {
            Some(Kind::Empty) | None => Owner::Empty,
            Some(Kind::ReadFile) => Owner::ReadFile(ReadFileOwner {
                poll: OwnerToken::from_nonzero(id),
            }),
            Some(Kind::WriteFile) => Owner::WriteFile(WriteFileOwner {
                poll: OwnerToken::from_nonzero(id),
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Owner {
    Empty,
    ReadFile(ReadFileOwner),
    WriteFile(WriteFileOwner),
}

impl Owner {
    #[inline]
    pub const fn is_empty(self) -> bool {
        matches!(self, Self::Empty)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadFileOwner {
    pub poll: OwnerToken<ReadFile>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WriteFileOwner {
    pub poll: OwnerToken<WriteFile>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner<T>(id: usize) -> OwnerToken<T> {
        OwnerToken::from_usize(id).unwrap()
    }

    #[test]
    fn token_round_trips_kernel_udata_shape() {
        let token = Token::encode::<ReadFile>(owner(0x1200));

        assert_eq!(token.as_u64() >> ADDR_BITS, Kind::ReadFile as u64);
        assert_eq!(token.owner_addr(), 0x1200);
        assert_eq!(
            token.decode(),
            Owner::ReadFile(ReadFileOwner {
                poll: owner(0x1200),
            })
        );
    }
}
