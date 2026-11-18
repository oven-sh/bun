//! The mutable state that an instruction keeps in its code block: caches and profiles.

use core::ops::Range;

macro_rules! metadata_kinds {
    ($($(#[$doc:meta])* $name:ident = $words:literal $($profiled:ident)?,)*) => {
        /// Entries of one kind are adjacent in the buffer, in the order of their instructions.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum MetadataKind {
            $($(#[$doc])* $name,)*
        }

        impl MetadataKind {
            pub const ALL: [MetadataKind; Self::COUNT] = [$(MetadataKind::$name),*];
            pub const COUNT: usize = [$($words),*].len();

            /// The size of an entry in words of 8 bytes.
            pub const fn words(self) -> u32 {
                match self {
                    $(MetadataKind::$name => $words,)*
                }
            }

            /// Whether the first word of an entry is the last value that the instruction produced.
            pub const fn has_value_profile(self) -> bool {
                match self {
                    $(MetadataKind::$name => metadata_kinds!(@profiled $($profiled)?),)*
                }
            }
        }
    };
    (@profiled profiled) => { true };
    (@profiled) => { false };
}

metadata_kinds! {
    Value = 1 profiled,
    UnaryArithmetic = 1,
    BinaryArithmetic = 1,
    /// Which ways the instruction has gone.
    Branch = 1,
    /// A cache that has no room for a case until it gets a list.
    LazyCache = 1,
    LazyCacheAndValue = 2 profiled,
    GetById = 4 profiled,
    GetByIdDirect = 4 profiled,
    GetLength = 5 profiled,
    PutById = 3,
    GetByVal = 3 profiled,
    ArrayAccess = 2,
    SetPrototype = 1,
    GetPrivateName = 5 profiled,
    PutPrivateName = 4,
    PrivateBrand = 4,
    GetGlobal = 3 profiled,
    PutGlobal = 2,
    GetImport = 3 profiled,
    ResolveDynamic = 2,
    GetDynamic = 3 profiled,
    PutDynamic = 2,
    Call = 4 profiled,
    SuperConstruct = 5 profiled,
    ToThis = 1 profiled,
    /// The callee whose prototype the last object got.
    CachedCallee = 1,
    NewObject = 2,
    NewArray = 1,
    NewArrayWithSpecies = 3 profiled,
    SharedRegExp = 1,
    ForIn = 3,
    ForInGet = 4 profiled,
    IterationModes = 1,
    IteratorNext = 3 profiled,
    Catch = 1,
    Coverage = 1,
}

const _: () = assert!(MetadataKind::COUNT <= 8 * MetadataLayout::KINDS_BYTES);

/// How many entries of each kind a code block has.
#[derive(Clone, Copy)]
pub struct MetadataLayout<'a> {
    /// A bit for each kind that has entries.
    kinds: u64,
    /// For each of those, the word at which its entries end: in two bytes, or in four.
    ends: &'a [u8],
}

impl<'a> MetadataLayout<'a> {
    pub(crate) const KINDS_BYTES: usize = 5;

    /// The kinds and the ends, or nothing.
    pub(crate) fn read(bytes: &'a [u8]) -> Option<MetadataLayout<'a>> {
        let Some((kinds, ends)) = bytes.split_first_chunk::<{ MetadataLayout::KINDS_BYTES }>()
        else {
            let (kinds, ends) = (0, bytes);
            return bytes.is_empty().then_some(MetadataLayout { kinds, ends });
        };
        let kinds = (kinds.iter().rev()).fold(0, |bits, &byte| bits << 8 | u64::from(byte));
        let count = kinds.count_ones() as usize;
        let is_valid = kinds >> MetadataKind::COUNT == 0
            && (ends.len() == 2 * count || ends.len() == 4 * count);
        is_valid.then_some(MetadataLayout { kinds, ends })
    }

    /// Where the first `present` kinds that have entries end.
    #[inline]
    fn end_of(self, present: u32) -> u32 {
        let Some(index) = (present as usize).checked_sub(1) else {
            return 0;
        };
        if self.ends.len() == 2 * self.kinds.count_ones() as usize {
            u32::from(u16::from_le_bytes(self.ends.as_chunks().0[index]))
        } else {
            u32::from_le_bytes(self.ends.as_chunks().0[index])
        }
    }

    pub fn words(self) -> u32 {
        self.end_of(self.kinds.count_ones())
    }

    /// The words that hold the entries of `kind`.
    pub fn range(self, kind: MetadataKind) -> Range<u32> {
        let bit = 1 << kind as u32;
        let below = self.kinds & (bit - 1);
        self.end_of(below.count_ones())..self.end_of((below | self.kinds & bit).count_ones())
    }

    pub fn count(self, kind: MetadataKind) -> u32 {
        let range = self.range(kind);
        (range.end - range.start) / kind.words()
    }

    /// The kinds that have entries, in the order of the buffer.
    #[inline]
    pub fn ranges(self) -> impl Iterator<Item = (MetadataKind, Range<u32>)> + 'a {
        let (mut rest, mut present, mut end) = (self.kinds, 0, 0);
        core::iter::from_fn(move || {
            let kind = *MetadataKind::ALL.get(rest.trailing_zeros() as usize)?;
            rest &= rest - 1;
            present += 1;
            let start = core::mem::replace(&mut end, self.end_of(present));
            Some((kind, start..end))
        })
    }
}
