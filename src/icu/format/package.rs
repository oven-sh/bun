//! The container: a header, the offsets of the items, the items.

pub const MAGIC: [u8; 4] = *b"BICU";

/// The magic number, the first cell and the number of units as `u16`, the number of items as `u32`.
pub const HEADER_SIZE: usize = 12;

/// Items other than cells start at a multiple of this. Zeros may follow an item.
pub const ALIGNMENT: usize = 4;

/// The size of the last item, so that text can be read in steps that go beyond it.
pub const PADDING: usize = 16;

/// `--trim` has removed what reads the item. It counts as missing.
pub const REMOVED: u32 = 1 << 30;
/// `--trim` has removed the language. Whoever opens the item ends the process.
pub const TOMBSTONED: u32 = 1 << 31;
const FLAGS: u32 = REMOVED | TOMBSTONED;

/// The items that are found by their index.
pub const KEYS: usize = 0;
pub const LOCALES: usize = 1;
pub const FILES: usize = 2;
pub const NUMBER_CODES: usize = 3;
/// One for each tree.
pub const FIRST_SCHEMA: usize = 4;
/// One for each tree from `FIRST_TREE_WITH_KEYS` on, which `--trim` removes with the tree.
const FIRST_OWN_KEYS: usize = FIRST_SCHEMA + TREES.len();
pub const FIRST_TREE_WITH_KEYS: usize = 2;
pub const FIXED_ITEMS: usize = keys_of(TREES.len());

/// The trees whose bundles are packed text, in the order of their columns.
pub const TREES: [&[u8]; 6] = [b"", b"zone", b"curr", b"unit", b"lang", b"region"];

/// The item with the keys of the bundles in the tree with this index. Trees that are not in `TREES` go with the first.
pub const fn keys_of(tree: usize) -> usize {
    match tree.checked_sub(FIRST_TREE_WITH_KEYS) {
        Some(index) => FIRST_OWN_KEYS + index,
        None => KEYS,
    }
}

/// A unit is a language in one script. It has one cell, which is an item, in each column: its model, then the trees.
pub const MODEL_COLUMN: usize = 0;
pub const FIRST_TREE_COLUMN: usize = 1;
pub const COLUMNS: usize = FIRST_TREE_COLUMN + TREES.len();
pub const MAX_UNITS: usize = 512;

#[derive(Clone, Copy)]
pub struct Package<'a>(&'a [u8]);

impl<'a> Package<'a> {
    #[inline]
    pub const fn new(bytes: &'a [u8]) -> Self {
        Self(bytes)
    }

    pub fn contains(self, part: &[u8]) -> bool {
        self.0.as_ptr_range().contains(&part.as_ptr())
    }

    #[inline]
    fn u32_at(self, at: usize) -> u32 {
        let field = self.0.get(at..).unwrap_or_default();
        field.first_chunk().map_or(0, |&it| u32::from_le_bytes(it))
    }

    #[inline]
    pub fn first_cell(self) -> usize {
        (self.u32_at(4) & 0xffff) as usize
    }

    pub fn units(self) -> usize {
        (self.u32_at(4) >> 16) as usize
    }

    #[inline]
    pub fn count(self) -> usize {
        self.u32_at(8) as usize
    }

    /// Where the offset and the flags of an item are. After those of the last item is the offset of its end.
    #[inline]
    pub const fn offset_field(item: usize) -> usize {
        HEADER_SIZE + 4 * item
    }

    /// `item` can be `count()`.
    #[inline]
    pub fn offset(self, item: usize) -> usize {
        (self.u32_at(Self::offset_field(item)) & !FLAGS) as usize
    }

    #[inline]
    pub fn flags(self, item: usize) -> u32 {
        self.u32_at(Self::offset_field(item)) & FLAGS
    }

    /// An item with flags is empty unless another one needs it.
    #[inline]
    pub fn item(self, item: usize) -> &'a [u8] {
        (self.0.get(self.offset(item)..self.offset(item + 1))).unwrap_or_default()
    }

    /// The item and all that follow it.
    #[inline]
    pub fn from_item(self, item: usize) -> &'a [u8] {
        self.0.get(self.offset(item)..).unwrap_or_default()
    }

    #[inline]
    pub fn cell(self, unit: usize, column: usize) -> usize {
        self.first_cell() + unit * COLUMNS + column
    }
}
