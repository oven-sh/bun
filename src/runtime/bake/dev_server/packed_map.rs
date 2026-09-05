//! `DevServer.PackedMap` — compact source-map slice (VLQ mappings + escaped
//! source contents) shared between `IncrementalGraph` files and
//! `SourceMapStore` entries.

use std::rc::Rc;

/// Line count newtype.
pub(crate) type LineCount = bun_core::GenericIndex<u32, u8>;

/// The fields threaded between chunks; generated line/column are recomputed per concatenation.
#[derive(Copy, Clone, Default)]
pub struct EndState {
    pub(crate) original_line: i32,
    pub(crate) original_column: i32,
    /// Chunk-local: 0 is this file, `1 + i` is `inner_sources[i]`.
    pub(crate) source_index: i32,
}

/// One entry of the input file's own sourcemap `sources[]`; `escaped_content` is JSON-quoted, empty when absent.
pub struct InnerSource {
    pub(crate) path: Box<[u8]>,
    pub(crate) escaped_content: Box<[u8]>,
}

/// Packed source mapping data for a single file.
pub struct PackedMap {
    /// Allocated by `dev.arena()`. Access with `.vlq()`.
    /// Stored to allow lazy construction of source map files.
    vlq_: Box<[u8]>,
    /// The bundler runs quoting on multiple threads, so it only makes sense
    /// to preserve that effort for concatenation and re-concatenation.
    escaped_source: Box<[u8]>,
    pub(crate) end_state: EndState,
    pub(crate) inner_sources: Box<[InnerSource]>,
}

impl PackedMap {
    pub(crate) fn new_non_empty(
        chunk: &mut bun_sourcemap::Chunk,
        escaped_source: Box<[u8]>,
        inner_sources: Box<[InnerSource]>,
    ) -> Rc<Self> {
        let buffer = &mut chunk.buffer;
        debug_assert!(!buffer.is_empty());
        Rc::new(Self {
            vlq_: buffer.to_owned_slice(),
            escaped_source,
            end_state: EndState {
                original_line: chunk.end_state.original_line,
                original_column: chunk.end_state.original_column,
                source_index: chunk.end_state.source_index,
            },
            inner_sources,
        })
    }

    /// `sources[]` slots this file occupies: itself plus its inner sources.
    #[inline]
    pub(crate) fn source_slot_count(&self) -> usize {
        1 + self.inner_sources.len()
    }

    #[inline]
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost =
            self.vlq().len() + self.quoted_contents().len() + core::mem::size_of::<Self>();
        for inner in self.inner_sources.iter() {
            cost += inner.path.len()
                + inner.escaped_content.len()
                + core::mem::size_of::<InnerSource>();
        }
        cost
    }

    #[inline]
    pub(crate) fn vlq(&self) -> &[u8] {
        &self.vlq_
    }

    // TODO: rename to `escaped_source`
    #[inline]
    pub(crate) fn quoted_contents(&self) -> &[u8] {
        &self.escaped_source
    }
}

/// HTML, CSS, Assets, and failed files do not have source maps. These cases
/// should never allocate an object. There is still relevant state for these
/// files to encode, so a tagged union is used.
///
/// An SoA split buys nothing for a 2-word payload (and `MultiArrayElement`
/// cannot be derived for an enum), so callers store `Vec<Shared>`.
#[derive(Default)]
pub enum Shared {
    Some(Rc<PackedMap>),
    #[default]
    None,
    LineCount(LineCount),
}

impl Shared {
    #[inline]
    pub(crate) fn get(&self) -> Option<&PackedMap> {
        match self {
            Shared::Some(p) => Some(p.as_ref()),
            _ => None,
        }
    }

    pub(crate) fn take(&mut self) -> Option<Rc<PackedMap>> {
        match core::mem::replace(self, Shared::None) {
            Shared::Some(p) => Some(p),
            other => {
                // Only the `Some` arm consumes the value, so restore the
                // original on miss.
                *self = other;
                None
            }
        }
    }

    #[inline]
    pub(crate) fn memory_cost(&self) -> usize {
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
