use core::cell::Cell;
use core::ops::Range;

use bun_alloc::AllocError;
use bun_engine_text::{CodeUnit, Text, with_text};
use smallvec::SmallVec;

use crate::{
    Cx, ElementKind, Gc, ImmutableArray, JsArray, JsResult, JsString, Storage, StringView, Value,
    Vm,
};

/// The addresses of two `StringImpl`s, which are not released before the cache is cleared.
type Key = (usize, usize);

const CACHE_SIZE: usize = 64;
const MAX_CACHED_PIECES: usize = 100_000;
const MAX_ATOMIZED_PIECES: usize = 100;

/// What strings that are likely to come again have been split into since the last collection.
pub(super) struct SplitCache([Cell<(Key, usize)>; CACHE_SIZE]);

impl Default for SplitCache {
    fn default() -> SplitCache {
        SplitCache([const { Cell::new(((0, 0), 0)) }; CACHE_SIZE])
    }
}

impl SplitCache {
    #[inline(always)]
    fn entries_for(&self, key: Key) -> [&Cell<(Key, usize)>; 2] {
        let index = (key.0 >> 4 ^ key.0 >> 10) + (key.1 >> 3);
        [index, index + 1].map(|index| &self.0[index % CACHE_SIZE])
    }

    #[inline(always)]
    fn get(&self, key: Key) -> Option<Gc<ImmutableArray>> {
        let entry = self
            .entries_for(key)
            .into_iter()
            .find(|it| it.get().0 == key)?;
        // SAFETY: made since the last collection.
        Some(unsafe { Gc::from_address(entry.get().1) })
    }

    fn insert(&self, key: Key, pieces: Gc<ImmutableArray>) {
        let [first, second] = self.entries_for(key);
        second.set(first.replace((key, pieces.address())));
    }

    pub(super) fn clear(&self) {
        self.0.iter().for_each(|entry| entry.set(((0, 0), 0)));
    }
}

impl StringView {
    /// A substring that is an atom if it looks like a name.
    #[inline]
    pub fn substring_for_key(&self, vm: &Vm, range: Range<usize>) -> Gc<JsString> {
        let text = self.text().slice(range.clone());
        match text.get(0) {
            Some(first) if first.is_ascii_alphabetic() || first.is(b'_') || first.is(b'$') => {
                JsString::try_from_text_as_atom(vm, text)
                    .unwrap_or_else(|_| self.substring(vm, range))
            }
            _ => self.substring(vm, range),
        }
    }
}

type Ends = SmallVec<[u32; 64]>;

/// Where each piece ends.
#[inline(always)]
fn find_ends(
    cx: &Cx,
    text: Text<'_>,
    separator: Text<'_>,
    limit: usize,
    ends: &mut Ends,
) -> JsResult<()> {
    const PIECES_PER_POLL: usize = 1 << 16;
    for end in text.matches(separator).chain([text.len()]).take(limit) {
        if ends.len() == ends.capacity()
            && (ends.len() >= Storage::MAX_VECTOR_LENGTH as usize || ends.try_reserve(1).is_err())
        {
            return Err(cx.throw_out_of_memory());
        }
        if ends.len() % PIECES_PER_POLL == PIECES_PER_POLL - 1 && cx.is_termination_requested() {
            return Err(cx.throw_termination());
        }
        ends.push(end as u32);
    }
    Ok(())
}

/// What the pieces are put in.
trait Pieces: Sized {
    fn try_from_fn(
        cx: &Cx,
        count: usize,
        piece: impl FnMut(usize) -> Value,
    ) -> Result<Gc<Self>, AllocError>;
}

impl Pieces for ImmutableArray {
    #[inline(always)]
    fn try_from_fn(
        cx: &Cx,
        count: usize,
        piece: impl FnMut(usize) -> Value,
    ) -> Result<Gc<Self>, AllocError> {
        ImmutableArray::try_from_fn(cx, count, piece)
    }
}

impl Pieces for JsArray {
    #[inline(always)]
    fn try_from_fn(
        cx: &Cx,
        count: usize,
        piece: impl FnMut(usize) -> Value,
    ) -> Result<Gc<Self>, AllocError> {
        let shape = cx.global().array_shape(ElementKind::Contiguous);
        JsArray::try_from_fn(cx, shape, [], count, piece)
    }
}

#[inline(never)]
fn split<P: Pieces>(
    cx: &Cx,
    string: &JsString,
    separator: &JsString,
    limit: usize,
    wants_atoms: bool,
) -> JsResult<Gc<P>> {
    let (view, separator) = (string.view(cx)?, separator.view(cx)?);
    let separator = separator.text();
    if separator.is_empty() {
        return cx.or_out_of_memory(with_text!(view.text(), |units| {
            P::try_from_fn(cx, units.len().min(limit), |index| {
                JsString::from_unit(cx, units[index].to_u16()).into()
            })
        }));
    }
    let mut ends = Ends::new();
    find_ends(cx, view.text(), separator, limit, &mut ends)?;
    let wants_atoms = wants_atoms && ends.len() < MAX_ATOMIZED_PIECES;
    let mut start = 0;
    cx.or_out_of_memory(P::try_from_fn(cx, ends.len(), |index| {
        let range = start..ends[index] as usize;
        start = range.end + separator.len();
        Value::from(if wants_atoms {
            view.substring_for_key(cx, range)
        } else {
            view.substring(cx, range)
        })
    }))
}

impl JsString {
    /// `String.prototype.split`, for a separator that is a string.
    pub fn split(&self, cx: &Cx, separator: &JsString, limit: u32) -> JsResult<Gc<JsArray>> {
        let recurring =
            (self.try_impl().zip(separator.try_impl())).filter(|(string, separator)| {
                limit == u32::MAX
                    && separator.is_atom()
                    && (string.is_atom() || self.is_read_again())
            });
        let Some((string, atom)) = recurring else {
            return split(cx, self, separator, limit as usize, false);
        };
        let (cache, key) = (
            &cx.services.text.strings.splits,
            (string.address(), atom.address()),
        );
        if let Some(pieces) = cache.get(key) {
            return JsArray::from_immutable(cx, pieces);
        }
        let wants_atoms = string.is_atom();
        let pieces = split::<ImmutableArray>(cx, self, separator, limit as usize, wants_atoms)?;
        if (pieces.len() as usize) < MAX_CACHED_PIECES {
            cache.insert(key, pieces);
        }
        JsArray::from_immutable(cx, pieces)
    }
}
