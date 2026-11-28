//! What the bundles of a tree can have. The upper tables are hosts, which exist only here. What hangs on them is in chunks.

use crate::key::Key;
use crate::words::Words;

/// The number of hosts, the number of chunks, the offset of each of these parts, the nodes, the parts.
#[derive(Clone, Copy, Default)]
pub struct Schema<'a>(Words<'a>);

pub const MAX_PARTS: usize = 256;
pub const ROOT: usize = 0;

/// The numbers of children and seeds, the key and the target of each child, their places in the order of the keys, the seeds.
#[derive(Clone, Copy)]
pub struct Host<'a>(Words<'a>);

/// A part, which is a host or a chunk, and the slot in a chunk. No record has the part of a link.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Target(pub u16);

impl Target {
    pub const SLOT_BITS: u32 = 6;
    pub const MAX_SLOTS: usize = 1 << Self::SLOT_BITS;
    pub const ALIAS: Self = Self(0xffff);
    pub const PARENT: Self = Self(0xfffe);

    #[inline]
    pub fn part(self) -> usize {
        (self.0 >> Self::SLOT_BITS).into()
    }

    #[inline]
    pub fn slot(self) -> usize {
        usize::from(self.0) % Self::MAX_SLOTS
    }
}

/// The numbers of leaves, slots and keys, the slots, the keys, the leaves. What hangs on a host is in a slot.
#[derive(Clone, Copy)]
pub struct Chunk<'a> {
    pub(crate) schema: Schema<'a>,
    words: Words<'a>,
}

/// A byte for each node without children, in the order of the slots: flags and the class.
pub struct Leaf;

impl Leaf {
    pub const CLASSES: usize = 64;
    /// What it copies from another language is not mapped.
    pub const IS_VERBATIM: u8 = 1 << 6;
    /// The next key of the chunk predicts its text.
    pub const HAS_KEY: u8 = 1 << 7;

    #[inline]
    pub fn class(leaf: u8) -> u8 {
        leaf % Self::CLASSES as u8
    }
}

/// `STRING`, `SWITCHES`, or the offset of a container: the kind and the number of children, the children, the keys of a table.
#[derive(Clone, Copy)]
pub struct Node(u16);

impl<'a> Schema<'a> {
    pub fn new(item: &'a [u8]) -> Self {
        Self(Words::of(item))
    }

    #[inline]
    pub fn hosts(self) -> usize {
        self.0.index_at(0)
    }

    #[inline]
    fn part(self, part: usize) -> Words<'a> {
        self.0.from(self.0.index_at(2 + part))
    }

    #[inline]
    pub fn host(self, part: usize) -> Host<'a> {
        Host(self.part(part))
    }

    #[inline]
    pub fn chunk(self, part: usize) -> Chunk<'a> {
        Chunk {
            schema: self,
            words: self.part(part),
        }
    }

    /// Returns the kind and the children, each with its key, which only a table has.
    #[inline]
    pub(crate) fn container(self, Node(offset): Node) -> (u16, impl Iterator<Item = (u16, Node)>) {
        let (offset, head) = (usize::from(offset), self.0.at(offset.into()));
        let count = usize::from(head % (1 << Node::KIND_SHIFT));
        let words = self.0.part(offset + 1, 2 * count);
        let (children, keys) = (words.part(0, count), words.from(count));
        (
            head >> Node::KIND_SHIFT,
            keys.iter().zip(children.iter().map(Node)),
        )
    }
}

impl<'a> Host<'a> {
    #[inline]
    pub fn index_of_seed(hash: u32, seeds: usize) -> usize {
        (hash as usize * seeds) >> 32
    }

    #[inline]
    pub fn place_with_seed(hash: u32, seed: u16, children: usize) -> usize {
        let hash = hash.rotate_left(16).wrapping_mul(2 * u32::from(seed) + 1);
        2 * ((hash as usize * children) >> 32)
    }

    #[inline]
    pub fn len(self) -> usize {
        self.0.index_at(0)
    }

    /// At the place of a child is the offset of its key.
    #[inline]
    pub fn keys(self) -> Words<'a> {
        self.0.from(2)
    }

    /// The place of the only child that can have `key`.
    #[inline(always)]
    pub fn place_for(self, key: Key) -> Option<usize> {
        let [children, seeds] = self.0.chunk_at(0)?.map(|it| u16::from_le_bytes(it).into());
        let hash = key.hash();
        let seed = (self.0).get(2 + 3 * children + Self::index_of_seed(hash, seeds))?;
        Some(Self::place_with_seed(hash, seed, children))
    }

    /// The places of the children in the order of their keys.
    #[inline]
    pub fn places(self) -> Words<'a> {
        self.0.part(2 + 2 * self.len(), self.len())
    }

    /// The offset of the key, and the target.
    #[inline(always)]
    pub fn child(self, place: usize) -> Option<(u16, Target)> {
        let [key, target] = self.0.chunk_at(2 + place)?.map(u16::from_le_bytes);
        Some((key, Target(target)))
    }
}

impl<'a> Chunk<'a> {
    #[inline]
    pub(crate) fn slots(self) -> impl ExactSizeIterator<Item = Node> {
        (self.words.part(3, self.words.index_at(1)).iter()).map(Node)
    }

    #[inline]
    pub fn leaves(self) -> &'a [u8] {
        let [leaves, slots, keys] = [0, 1, 2].map(|i| self.words.index_at(i));
        let bytes = self.words.from(3 + slots + keys).as_bytes();
        bytes.get(..leaves).unwrap_or_default()
    }

    /// Yields the index of a leaf and the offset of the part of a key that predicts its text.
    #[inline]
    pub(crate) fn keys(self) -> impl Iterator<Item = (usize, u16)> {
        let keys = self.words.from(3 + self.words.index_at(1));
        let keys = (0..self.words.index_at(2)).map(move |i| keys.at(i));
        let leaves = self.leaves().iter().enumerate();
        let mut leaves = leaves.filter(|it| it.1 & Leaf::HAS_KEY != 0);
        keys.map_while(move |key| Some((leaves.next()?.0, key)))
    }
}

impl Node {
    pub const STRING: u16 = 0;
    /// Two integers that are 0 or 1. They are coded as the lowest bits of a digit.
    pub const SWITCHES: u16 = 1;

    pub const KIND_SHIFT: u32 = 12;
    /// A kind beside those of items: one of the children.
    pub const EITHER: u16 = 0;

    #[inline]
    pub(crate) fn is_container(self) -> bool {
        self.0 > Self::SWITCHES
    }

    #[inline]
    pub(crate) fn is_string(self) -> bool {
        self.0 == Self::STRING
    }
}
