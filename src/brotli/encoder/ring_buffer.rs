use bun_highway::brotli::Place;

use super::matching::bytes_at;
use crate::memory::{self, Result};

/// Hashing reads eight bytes, even for the last byte of the input.
pub(super) const SLACK: usize = 7;

/// The recent input. A copy of the start follows the end, so that a block can be read without wrapping.
pub(super) struct RingBuffer {
    bytes: Vec<u8>,
    size: usize,
    tail_size: usize,
    received: u64,
}

impl RingBuffer {
    pub(super) fn new(size_bits: u32, tail_bits: u32) -> Self {
        Self {
            bytes: Vec::new(),
            size: 1 << size_bits,
            tail_size: 1 << tail_bits,
            received: 0,
        }
    }

    pub(super) fn received(&self) -> u64 {
        self.received
    }

    pub(super) fn window(&self) -> Window<'_> {
        Window {
            bytes: &self.bytes,
            mask: (self.size - 1) as u32,
        }
    }

    /// `input` is no longer than the tail.
    pub(super) fn write(&mut self, mut input: &[u8]) -> Result<()> {
        if self.received < self.size as u64 {
            let position = self.received as usize;
            let (fits, rest) = input.split_at(input.len().min(self.size - position));
            self.bytes.truncate(position);
            let capacity = if position == 0 && fits.len() < self.tail_size {
                fits.len() + SLACK
            } else {
                self.size + self.tail_size + SLACK
            };
            memory::try_reserve_total(&mut self.bytes, capacity)?;
            self.bytes.extend_from_slice(fits);
            if self.bytes.len() == self.size {
                self.bytes.extend_from_within(..self.tail_size);
            }
            self.bytes.extend([0; SLACK]);
            self.received += fits.len() as u64;
            input = rest;
        }
        while !input.is_empty() {
            let position = self.received as usize & (self.size - 1);
            let (fits, rest) = input.split_at(input.len().min(self.size - position));
            self.bytes[position..][..fits.len()].copy_from_slice(fits);
            if let Some(room) = self.tail_size.checked_sub(position) {
                let mirrored = position..position + fits.len().min(room);
                self.bytes.copy_within(mirrored, self.size + position);
            }
            self.received += fits.len() as u64;
            input = rest;
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(super) struct Window<'a> {
    pub(super) bytes: &'a [u8],
    mask: u32,
}

impl<'a> Window<'a> {
    /// Of `position` in `bytes`.
    #[inline(always)]
    pub(super) fn index(&self, position: usize) -> usize {
        (position as u32 & self.mask) as usize
    }

    /// How many bytes follow `position` before the ring ends.
    #[inline(always)]
    pub(super) fn before_end(&self, position: usize) -> usize {
        (!(position as u32) & self.mask) as usize
    }

    #[inline(always)]
    pub(super) fn byte(&self, position: usize) -> u8 {
        self.bytes[self.index(position)]
    }

    #[inline(always)]
    pub(super) fn bytes_at<const N: usize>(&self, position: usize) -> [u8; N] {
        bytes_at(self.bytes, self.index(position))
    }

    /// `pair` is `offset` bytes after `position`.
    #[inline(always)]
    pub(super) fn place(&self, position: usize, offset: usize, pair: [u8; 2]) -> Place<'a> {
        Place {
            ring: &self.bytes[offset..],
            ring_mask: self.mask,
            position: position as u32,
            pair,
        }
    }

    /// From `position` up to the end of the tail.
    #[inline(always)]
    pub(super) fn from(&self, position: usize) -> &'a [u8] {
        &self.bytes[self.index(position)..]
    }

    #[inline(always)]
    pub(super) fn without_tail(&self) -> &'a [u8] {
        &self.bytes[..self.bytes.len().min(self.mask as usize + 1)]
    }

    /// Before and after the end of the ring.
    pub(super) fn parts(&self, position: usize, length: usize) -> [&'a [u8]; 2] {
        let first = length.min(self.before_end(position) + 1);
        [&self.from(position)[..first], &self.bytes[..length - first]]
    }
}
