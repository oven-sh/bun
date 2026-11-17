//! Earlier positions in the window by the hash of what starts there.

use bun_core::ffi::try_boxed_zeroed;
use bun_highway::zlib::subtract_saturating;

use super::window::chunk;
use crate::array::At;
use crate::error::Result;
use crate::format::MIN_MATCH;
use crate::vec;

/// So many bytes are hashed, but for the rolling hash. Only lazy matching takes shorter matches.
pub(super) const HASHED_LEN: u32 = 4;
const MIN_LINKS: usize = 512;

type Heads = [u16; 1 << 16];

/// Position 0 stands for none.
pub(super) struct Chains {
    heads: Box<Heads>,
    /// From a position, modulo the length, to the one before it. As long as the power of two that it has had to be.
    links: Vec<u16>,
    rolling_hash: u32,
}

impl Chains {
    pub(super) fn new(window_size: u32) -> Result<Self> {
        let mut links = vec::with_room(window_size as usize)?;
        links.resize_with(MIN_LINKS, || 0);
        Ok(Self {
            heads: try_boxed_zeroed()?,
            links,
            rolling_hash: 0,
        })
    }

    pub(super) fn clear(&mut self) {
        self.heads.fill(0);
    }

    /// The same, if nothing has been inserted but what `hashed` has, and not by the rolling hash.
    pub(super) fn clear_hashes_of(&mut self, hashed: &[u8]) {
        for &bytes in hashed.array_windows() {
            *self.heads.at_mut(hash(bytes) as usize) = 0;
        }
        debug_assert!(self.heads.iter().all(|&head| head == 0));
    }

    pub(super) fn reset_rolling_hash(&mut self) {
        self.rolling_hash = 0;
    }

    /// Before positions up to `end` are inserted.
    pub(super) fn grow(&mut self, end: u32) {
        let len = (end as usize)
            .next_power_of_two()
            .min(self.links.capacity());
        if self.links.len() < len {
            self.links.resize_with(len, || 0);
        }
    }

    pub(super) fn slide(&mut self, window_size: u32) {
        for positions in [self.heads.as_mut_slice(), &mut self.links] {
            subtract_saturating(positions.as_chunks_mut().0, window_size as u16);
        }
    }

    #[inline(always)]
    pub(super) fn over<'a>(&'a mut self, window: &'a [u8]) -> Index<'a> {
        Index {
            window,
            heads: &mut self.heads,
            link_mask: self.links.len().wrapping_sub(1),
            links: &mut self.links,
            rolling_hash: &mut self.rolling_hash,
        }
    }
}

// https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/insert_string_roll.c#L13
#[inline(always)]
pub(super) fn roll(hash: u32, byte: u8) -> u32 {
    (hash << 5 ^ u32::from(byte)) % (1 << 15)
}

// https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/insert_string.c#L13
#[inline(always)]
fn hash(bytes: [u8; HASHED_LEN as usize]) -> u32 {
    u32::from_le_bytes(bytes).wrapping_mul(2654435761) >> 16
}

/// The chains and what they point into.
pub(super) struct Index<'a> {
    pub(super) window: &'a [u8],
    heads: &'a mut Heads,
    links: &'a mut [u16],
    link_mask: usize,
    rolling_hash: &'a mut u32,
}

impl Index<'_> {
    #[inline(always)]
    pub(super) fn head(&self, hash: u32) -> u32 {
        (*self.heads.at(hash as usize)).into()
    }

    #[inline(always)]
    pub(super) fn link(&self, position: u32) -> u32 {
        let link = self.links.get(position as usize & self.link_mask);
        link.copied().map_or(0, u32::from)
    }

    #[inline(always)]
    fn insert_hash(&mut self, hash: u32, position: u32) -> u32 {
        let head = self.heads.at_mut(hash as usize);
        let previous = *head;
        if u32::from(previous) != position {
            *head = position as u16;
            if let Some(link) = self.links.get_mut(position as usize & self.link_mask) {
                *link = previous;
            }
        }
        previous.into()
    }

    /// Returns the position that was inserted last with the same hash. `bytes` are those at `position`.
    #[inline(always)]
    pub(super) fn insert<const ROLLING: bool>(
        &mut self,
        position: u32,
        bytes: [u8; HASHED_LEN as usize],
    ) -> u32 {
        if ROLLING {
            *self.rolling_hash = roll(*self.rolling_hash, bytes[MIN_MATCH - 1]);
            return self.insert_hash(*self.rolling_hash, position);
        }
        self.insert_hash(hash(bytes), position)
    }

    #[inline(always)]
    pub(super) fn insert_at(&mut self, position: u32) {
        if let Some(&bytes) = chunk(self.window, position) {
            self.insert::<false>(position, bytes);
        }
    }

    /// Out of line, so that its loop has all registers to itself.
    #[inline(never)]
    pub(super) fn insert_all<const ROLLING: bool>(&mut self, start: u32, len: u32) {
        let (first, first_link) = (start as usize, start as usize & self.link_mask);
        let hashed = first..first + len as usize + HASHED_LEN as usize - 1;
        let (Some(hashed), Some(links)) = (
            self.window.get(hashed),
            self.links.get_mut(first_link..first_link + len as usize),
        ) else {
            return self.insert_one_by_one::<ROLLING>(start, len);
        };
        let (mut done, mut rolling_hash) = (0, *self.rolling_hash);
        while let Some(link) = links.get_mut(done)
            && let Some(&[a, b, c, d]) = hashed.get(done..done + HASHED_LEN as usize)
        {
            let hash = if ROLLING {
                roll(rolling_hash, c)
            } else {
                hash([a, b, c, d])
            };
            let head = self.heads.at_mut(hash as usize);
            if usize::from(*head) == first + done {
                break;
            }
            *link = core::mem::replace(head, (first + done) as u16);
            (done, rolling_hash) = (done + 1, hash);
        }
        if ROLLING {
            *self.rolling_hash = rolling_hash;
        }
        if done != len as usize {
            self.insert_one_by_one::<ROLLING>(start + done as u32, len - done as u32);
        }
    }

    /// For when the links wrap around, or a position has been inserted before.
    #[cold]
    #[inline(never)]
    fn insert_one_by_one<const ROLLING: bool>(&mut self, start: u32, len: u32) {
        for position in start..start + len {
            if let Some(&bytes) = chunk(self.window, position) {
                self.insert::<ROLLING>(position, bytes);
            }
        }
    }

    pub(super) fn restart_rolling_hash(&mut self, position: u32) {
        if let Some(&[first, second, ..]) = self.window.get(position as usize..) {
            *self.rolling_hash = roll(first.into(), second);
        }
    }
}
