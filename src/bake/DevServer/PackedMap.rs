//! Packed source mapping data for a single file.
//! Owned by one IncrementalGraph file and/or multiple SourceMapStore entries.

use std::rc::Rc;

use bun_core::assert_eql;
use bun_sourcemap::Chunk as SourceMapChunk;

/// Packed source mapping data for a single file.
pub struct PackedMap {
    /// Allocated by `dev.allocator()`. Access with `.vlq()`
    /// This is stored to allow lazy construction of source map files.
    // TODO(port): Zig used `OwnedIn([]u8, DevAllocator)` — verify global mimalloc is correct here
    vlq_: Box<[u8]>,
    /// The bundler runs quoting on multiple threads, so it only makes
    /// sense to preserve that effort for concatenation and
    /// re-concatenation.
    escaped_source: Box<[u8]>,
    /// Used to track the last state of the source map chunk. This
    /// is used when concatenating chunks. The generated column is
    /// not tracked because it is always zero (all chunks end in a
    /// newline because minification is off), and the generated line
    /// is recomputed on demand and is different per concatenation.
    pub end_state: EndState,
}

#[derive(Clone, Copy)]
pub struct EndState {
    pub original_line: i32,
    pub original_column: i32,
}

impl PackedMap {
    pub fn new_non_empty(chunk: &mut SourceMapChunk, escaped_source: Box<[u8]>) -> Rc<Self> {
        let buffer = &mut chunk.buffer;
        debug_assert!(!buffer.is_empty());
        // TODO(port): Zig downcasts `buffer.allocator` to `DevAllocator`; allocator param dropped in Rust
        Rc::new(Self {
            vlq_: buffer.to_owned_slice(),
            escaped_source,
            end_state: EndState {
                original_line: chunk.end_state.original_line,
                original_column: chunk.end_state.original_column,
            },
        })
    }

    // PORT NOTE: `deinit` deleted — `Box<[u8]>` fields drop automatically.

    pub fn memory_cost(&self) -> usize {
        self.vlq().len() + self.quoted_contents().len() + core::mem::size_of::<Self>()
    }

    pub fn vlq(&self) -> &[u8] {
        &self.vlq_
    }

    // TODO: rename to `escaped_source`
    pub fn quoted_contents(&self) -> &[u8] {
        &self.escaped_source
    }
}

// `ci_assert` builds add a `safety::ThreadLock`
// TODO(port): gate on the Rust equivalent of `Environment.ci_assert`
#[cfg(not(feature = "ci_assert"))]
const _: () = {
    assert!(core::mem::size_of::<PackedMap>() == core::mem::size_of::<usize>() * 5);
    assert!(core::mem::align_of::<PackedMap>() == core::mem::align_of::<usize>());
};

// Zig: `bun.GenericIndex(u32, u8)` — the `u8` is a type tag; newtype suffices.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct LineCount(pub u32);

/// HTML, CSS, Assets, and failed files do not have source maps. These cases
/// should never allocate an object. There is still relevant state for these
/// files to encode, so a tagged union is used.
pub enum Shared {
    Some(Rc<PackedMap>),
    None,
    LineCount(LineCount),
}

impl Shared {
    pub fn get(&self) -> Option<&PackedMap> {
        match self {
            Shared::Some(ptr) => Some(ptr.as_ref()),
            _ => None,
        }
    }

    pub fn take(&mut self) -> Option<Rc<PackedMap>> {
        match core::mem::replace(self, Shared::None) {
            Shared::Some(ptr) => Some(ptr),
            other => {
                // PORT NOTE: reshaped for borrowck — Zig only writes `.none` on the `.some` arm,
                // so restore the original value for the non-`some` arms.
                *self = other;
                None
            }
        }
    }

    // PORT NOTE: `deinit` deleted — `Rc<PackedMap>` drops automatically.

    /// Amortized memory cost across all references to the same `PackedMap`
    pub fn memory_cost(&self) -> usize {
        match self {
            Shared::Some(ptr) => ptr.memory_cost() / Rc::strong_count(ptr).max(1),
            _ => 0,
        }
    }
}

impl Clone for Shared {
    fn clone(&self) -> Self {
        match self {
            Shared::Some(ptr) => Shared::Some(Rc::clone(ptr)),
            Shared::None => Shared::None,
            Shared::LineCount(lc) => Shared::LineCount(*lc),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/PackedMap.zig (124 lines)
//   confidence: medium
//   todos:      3
//   notes:      OwnedIn<[]u8, DevAllocator> mapped to Box<[u8]>; verify DevAllocator semantics in Phase B
// ──────────────────────────────────────────────────────────────────────────
