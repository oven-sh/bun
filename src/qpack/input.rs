//! What field sections and instructions are made of (RFC 9204 §4.1).

use bun_hpack::integer;
use bun_hpack::literal::Literal;

/// Of an integer with its prefix.
pub(crate) const MAX_INTEGER_LEN: usize = 10;

pub(crate) enum Stop {
    Incomplete,
    Invalid,
}

impl From<bun_hpack::Error> for Stop {
    #[inline(always)]
    fn from(_: bun_hpack::Error) -> Self {
        Self::Invalid
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Input<'a> {
    whole: &'a [u8],
    rest: &'a [u8],
}

impl<'a> Input<'a> {
    #[inline(always)]
    pub(crate) fn new(whole: &'a [u8]) -> Self {
        Self { whole, rest: whole }
    }

    #[inline(always)]
    pub(crate) fn byte(&mut self) -> Result<u8, Stop> {
        self.rest.split_off_first().copied().ok_or(Stop::Incomplete)
    }

    /// `first` holds the prefix. The result has 62 bits at most.
    #[inline(always)]
    pub(crate) fn integer(&mut self, first: u8, prefix_bits: u32) -> Result<usize, Stop> {
        let full = u8::MAX >> (8 - prefix_bits);
        match (first & full, self.rest) {
            (prefix, _) if prefix < full => Ok(prefix.into()),
            (_, &[last @ ..0x80, ref rest @ ..]) => {
                self.rest = rest;
                Ok(usize::from(full) + usize::from(last))
            }
            _ => self.long_integer(first, prefix_bits),
        }
    }

    #[cold]
    #[inline(never)]
    fn long_integer(&mut self, first: u8, prefix_bits: u32) -> Result<usize, Stop> {
        const MAX_LEN: usize = MAX_INTEGER_LEN - 1;
        let available = self.rest.len();
        match integer::read_up_to::<MAX_LEN>(first, prefix_bits, &mut self.rest) {
            Ok(value) if value < 1 << 62 => Ok(value),
            Err(_) if available < MAX_LEN => Err(Stop::Incomplete),
            _ => Err(Stop::Invalid),
        }
    }

    /// `first` holds the prefix of the length and, above it, the bit that marks the Huffman code.
    #[inline(always)]
    pub(crate) fn literal(&mut self, first: u8, prefix_bits: u32) -> Result<Literal<'a>, Stop> {
        let len = self.integer(first, prefix_bits)?;
        let bytes = self.rest.split_off(..len).ok_or(Stop::Incomplete)?;
        let (context, _) = self.whole.split_at(self.whole.len() - self.rest.len());
        Ok(Literal {
            bytes,
            context,
            is_huffman: first & 1 << prefix_bits != 0,
        })
    }

    #[inline(always)]
    pub(crate) fn value(&mut self) -> Result<Literal<'a>, Stop> {
        let first = self.byte()?;
        self.literal(first, 7)
    }
}

/// `read` has to leave an incomplete instruction without effect. It is kept in `partial`, up to `max_len`.
#[inline(always)]
pub(crate) fn read_instructions(
    partial: &mut Vec<u8>,
    mut bytes: &[u8],
    max_len: usize,
    mut read: impl FnMut(u8, &mut Input<'_>) -> Result<(), Stop>,
) -> Option<()> {
    while !bytes.is_empty() {
        let held = partial.len();
        let mut input = Input::new(if held == 0 {
            bytes
        } else {
            partial.extend_from_slice(bytes.get(..max_len - held).unwrap_or(bytes));
            partial
        });
        match input.byte().and_then(|first| read(first, &mut input)) {
            Ok(()) => {
                let taken = input.whole.len() - input.rest.len() - held;
                bytes = bytes.get(taken..).unwrap_or_default();
                *partial = Vec::new();
            }
            Err(Stop::Incomplete) if input.whole.len() < max_len => {
                if held == 0 {
                    partial.extend_from_slice(bytes);
                }
                break;
            }
            Err(_) => return None,
        }
    }
    Some(())
}
