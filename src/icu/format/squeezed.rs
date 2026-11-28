//! Items that are read as a whole, and rarely: literal bytes, and copies of earlier ones.

use crate::words::{Slots, take_bytes, take_number};

pub const MAX_ITEMS: usize = 32;

/// The lowest first bytes of commands. The lower bits have the length less the minimum. Literal bytes start at 0.
pub mod command {
    /// Literal bytes, each of which a zero is to follow.
    pub const NARROW: u8 = 0x20;
    /// A copy. The distance less one follows as a number.
    pub const COPY: u8 = 0x40;
    /// A copy of which more of the length follows as a number, before the distance.
    pub const LONG_COPY: u8 = 0xff;
    pub const MIN_COPY: usize = 3;
}

/// The number of the item, below `MAX_ITEMS`, the length, the length of what the item before it has to supply, the commands.
#[derive(Clone, Copy)]
pub struct Squeezed<'a> {
    pub number: usize,
    pub length: usize,
    /// Copies can reach back into the item before this one unless it is 0.
    pub base_length: usize,
    commands: &'a [u8],
}

impl<'a> Squeezed<'a> {
    pub fn new(mut bytes: &'a [u8]) -> Self {
        Self {
            number: take_number(&mut bytes),
            length: take_number(&mut bytes),
            base_length: take_number(&mut bytes),
            commands: bytes,
        }
    }

    /// `out` is zeroed but for the base at its start, and has room for no more than the item after that.
    pub fn expand(&self, out: &mut [u8]) {
        let (mut rest, mut at) = (self.commands, self.base_length);
        while at < out.len()
            && let Some((&head, after)) = rest.split_first()
        {
            rest = after;
            if head >= command::COPY {
                let mut length = usize::from(head - command::COPY) + command::MIN_COPY;
                if head == command::LONG_COPY {
                    length += take_number(&mut rest);
                }
                let distance = take_number(&mut rest) + 1;
                let end = at + length;
                while let Some(from) = at.checked_sub(distance)
                    && let Some((before, to)) = out.get_mut(..end).map(|it| it.split_at_mut(at))
                    && let Some(last) = before.last().filter(|_| !to.is_empty())
                {
                    if distance == 1 {
                        to.fill(*last);
                        break;
                    }
                    let (to, from) = (to.iter_mut(), before.get(from..).unwrap_or_default());
                    at += to.len().min(distance);
                    to.zip(from).for_each(|(to, &from)| *to = from);
                }
                at = end;
            } else {
                let step = 1 + usize::from(head >= command::NARROW);
                for &byte in take_bytes(&mut rest, usize::from(head % command::NARROW) + 1) {
                    out.put(at, byte);
                    at += step;
                }
            }
        }
    }
}
