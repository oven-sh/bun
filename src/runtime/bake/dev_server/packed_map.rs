//! `DevServer.PackedMap` — compact source-map slice (VLQ mappings + escaped
//! source contents) shared between `IncrementalGraph` files and
//! `SourceMapStore` entries. Spec: src/runtime/bake/DevServer/PackedMap.zig.

use std::rc::Rc;

/// Line count newtype (Zig: `bun.GenericIndex(u32, u8)`).
pub type LineCount = bun_core::GenericIndex<u32, u8>;

/// `PackedMap.end_state` — only the two fields the bundler needs to thread
/// between chunks (generated_column is always 0 because minification is off,
/// generated_line is recomputed per concatenation).
#[derive(Copy, Clone, Default)]
pub struct EndState {
    pub original_line: i32,
    pub original_column: i32,
}

/// Packed source mapping data for a single file.
pub struct PackedMap {
    /// Allocated by `dev.arena()`. Access with `.vlq()`.
    /// Stored to allow lazy construction of source map files.
    vlq_: Box<[u8]>,
    /// The bundler runs quoting on multiple threads, so it only makes sense
    /// to preserve that effort for concatenation and re-concatenation.
    escaped_source: Box<[u8]>,
    pub end_state: EndState,
}

impl PackedMap {
    pub fn new_non_empty(chunk: &mut bun_sourcemap::Chunk, escaped_source: Box<[u8]>) -> Rc<Self> {
        let buffer = &mut chunk.buffer;
        debug_assert!(!buffer.is_empty());
        Rc::new(Self {
            vlq_: buffer.to_owned_slice(),
            escaped_source,
            end_state: EndState {
                original_line: chunk.end_state.original_line,
                original_column: chunk.end_state.original_column,
            },
        })
    }

    #[inline]
    pub fn memory_cost(&self) -> usize {
        self.vlq().len() + self.quoted_contents().len() + core::mem::size_of::<Self>()
    }

    #[inline]
    pub fn vlq(&self) -> &[u8] {
        &self.vlq_
    }

    // TODO: rename to `escaped_source`
    #[inline]
    pub fn quoted_contents(&self) -> &[u8] {
        &self.escaped_source
    }
}

/// HTML, CSS, Assets, and failed files do not have source maps. These cases
/// should never allocate an object. There is still relevant state for these
/// files to encode, so a tagged union is used.
///
/// PORT NOTE: Zig `bun.MultiArrayList(Shared)` SoA split buys nothing for a
/// 2-word payload and `MultiArrayElement` cannot be derived for an enum, so
/// callers store `Vec<Shared>`.
#[derive(Default)]
pub enum Shared {
    Some(Rc<PackedMap>),
    #[default]
    None,
    LineCount(LineCount),
}

impl Shared {
    #[inline]
    pub fn get(&self) -> Option<&PackedMap> {
        match self {
            Shared::Some(p) => Some(p.as_ref()),
            _ => None,
        }
    }

    pub fn take(&mut self) -> Option<Rc<PackedMap>> {
        match core::mem::replace(self, Shared::None) {
            Shared::Some(p) => Some(p),
            other => {
                // PORT NOTE: reshaped for borrowck — Zig only writes `.none`
                // on the `.some` arm, so restore the original on miss.
                *self = other;
                None
            }
        }
    }

    #[inline]
    pub fn memory_cost(&self) -> usize {
        match self {
            Shared::Some(p) => p.memory_cost(),
            _ => 0,
        }
    }
}

impl Clone for Shared {
    fn clone(&self) -> Self {
        match self {
            Shared::Some(p) => Shared::Some(Rc::clone(p)),
            Shared::None => Shared::None,
            Shared::LineCount(c) => Shared::LineCount(*c),
        }
    }
}
