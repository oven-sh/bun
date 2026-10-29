//! Reads of the console formatter that run no user code.

use crate::{JSGlobalObject, JSValue};

/// The length of an array, or the own data `length` of an `arguments` object. Without one: one past the last present index.
pub(super) fn array_length(global: &JSGlobalObject, value: JSValue) -> u64 {
    crate::cpp::Bun__FormatterReads__arrayLength(global, value)
}

/// JSX children print a longer run of holes as one `N x empty items` line.
pub(super) const MAX_EXPANDED_HOLE_RUN: u32 = 8;

/// Steps through the indexes a list holds in time linear in what it holds, whatever length it claims.
#[derive(Default)]
pub(super) struct PresentIndexes {
    /// The sparse map's indexes in ascending order, copied at the first hole.
    sparse: Option<Vec<u32>>,
    pos: usize,
}

impl PresentIndexes {
    /// The smallest index in `from..len` that `list` holds, or `len`.
    pub(super) fn next(&mut self, list: JSValue, from: u32, len: u32) -> u32 {
        let in_vector = match crate::cpp::Bun__JSObject__nextPresentVectorIndex(list, from) {
            u64::MAX => len,
            index => index as u32,
        };
        let sparse = self
            .sparse
            .get_or_insert_with(|| sorted_sparse_indexes(list, from, len));
        while sparse.get(self.pos).is_some_and(|&index| index < from) {
            self.pos += 1;
        }
        let in_sparse_map = sparse.get(self.pos).copied().unwrap_or(len);
        in_vector.min(in_sparse_map).min(len)
    }
}

fn sorted_sparse_indexes(list: JSValue, start: u32, end: u32) -> Vec<u32> {
    use bun_core::UnwrapOrOom as _;
    let mut out: Vec<u32> = Vec::new();
    loop {
        let capacity = u32::try_from(out.capacity()).unwrap_or(u32::MAX);
        // SAFETY: `out` has room for `capacity` u32s and C++ writes at most that many.
        let count = unsafe {
            crate::cpp::Bun__JSObject__copySortedSparseIndexes(
                list,
                start,
                end,
                out.as_mut_ptr(),
                capacity,
            )
        };
        if count <= capacity {
            // SAFETY: C++ initialized the first `count <= capacity` elements.
            unsafe { out.set_len(count as usize) };
            return out;
        }
        out.try_reserve_exact(count as usize).unwrap_or_oom();
    }
}
