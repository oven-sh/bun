use bun_collections::smallvec::SmallVec;
use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult};

pub struct JSArrayIterator<'a> {
    pub i: u32,
    pub len: u32,
    array: JSValue,
    pub global: &'a JSGlobalObject,
    /// Direct pointer into the JSArray butterfly when the array has Int32 or
    /// Contiguous storage and a sane prototype chain. Holes are encoded as 0.
    fast: Option<*const JSValue>,
}

impl<'a> JSArrayIterator<'a> {
    /// Iterating straight out of the butterfly (see `fast`), so `next()`
    /// cannot run user JS.
    pub fn is_fast(&self) -> bool {
        self.fast.is_some()
    }

    pub fn init(value: JSValue, global: &'a JSGlobalObject) -> JsResult<JSArrayIterator<'a>> {
        let mut length: u32 = 0;
        let elements = Bun__JSArray__getContiguousVector(value, &mut length);
        if !elements.is_null() {
            return Ok(JSArrayIterator {
                i: 0,
                len: length,
                array: value,
                global,
                fast: Some(elements),
            });
        }
        Ok(JSArrayIterator {
            i: 0,
            len: value.get_length(global)? as u32,
            array: value,
            global,
            fast: None,
        })
    }

    pub fn next(&mut self) -> JsResult<Option<JSValue>> {
        if !(self.i < self.len) {
            return Ok(None);
        }
        let i = self.i;
        self.i += 1;
        if let Some(elements) = self.fast {
            if Bun__JSArray__contiguousVectorIsStillValid(self.array, elements, self.len) {
                // SAFETY: validity check above guarantees `elements[0..self.len]`
                // still backs the array's butterfly; `i < self.len`.
                let val = unsafe { *elements.add(i as usize) };
                return Ok(Some(if val.is_empty() {
                    JSValue::UNDEFINED
                } else {
                    val
                }));
            }
            self.fast = None;
        }
        Ok(Some(JSObject::get_index(self.array, self.global, i)?))
    }
}

/// Walks the own present indexes of one array in ascending order, from where
/// `JSValue::next_present_index` answered `PresentIndex::InSparseMap`.
///
/// The sparse map has no order, so an answer from it costs a pass over all of it. The first
/// answer of a walk is one scan. After that a pass lists the next indexes and the walk reads the
/// list: 4 of them, then twice as many each time.
///
/// The list holds indexes, not elements, so the array can change during the walk. A listed index
/// that is gone still comes back, and reads as a hole. An index that is added where a pass
/// already listed does not come back.
pub(crate) struct PresentIndexCursor {
    /// Memory for the listed indexes. Only the C++ side reads and writes them: the length stays 0.
    room: SmallVec<[u32; 4]>,
    /// How many indexes the next pass lists.
    batch: u32,
    list: PresentIndexList,
}

/// Mirrors `PresentIndexList` in bindings.cpp, which describes the fields.
#[repr(C)]
struct PresentIndexList {
    count: u32,
    position: u32,
    last: u32,
    remaining: u32,
}

const _: () = assert!(size_of::<PresentIndexList>() == 16);

impl PresentIndexCursor {
    pub(crate) fn new() -> Self {
        let room = SmallVec::new();
        Self {
            batch: room.inline_size() as u32,
            room,
            list: PresentIndexList {
                count: 0,
                position: 0,
                last: 0,
                // `PresentIndexList::notScanned`
                remaining: u32::MAX,
            },
        }
    }

    /// The smallest own present index of `value` that is `>= start`, or `None` when every index
    /// from `start` on is a hole. One cursor takes one `value`, and a `start` that never gets
    /// smaller. `want` is how many more present indexes the walk can use: no pass lists more.
    pub(crate) fn next(&mut self, value: JSValue, start: u32, want: u32) -> Option<u32> {
        debug_assert!(value.is_cell() && value.js_type().is_array());
        let list = &mut self.list;
        if list.count != 0 && list.last < start && list.remaining != 0 {
            // The list is used up and the sparse map has more. The next pass lists twice as many,
            // as far as the walk can use them. The memory is for all that it can use, so it grows
            // once. A failed reserve leaves it at the size it has.
            list.count = 0;
            list.position = 0;
            let most = want.min(list.remaining).max(1);
            if most as usize > self.room.capacity() {
                let _ = self.room.try_reserve_exact(most as usize);
            }
            let room = u32::try_from(self.room.capacity()).unwrap_or(u32::MAX);
            self.batch = self.batch.saturating_mul(2).min(most).min(room);
        }
        // SAFETY: `room` has space for `batch` indexes and nothing else uses that space during the
        // call. The `list.count` indexes that C++ reads are ones that it wrote there: `count` is 0
        // whenever `batch` or the space changes.
        let found = unsafe {
            Bun__JSArray__nextPresentIndexListed(value, start, list, self.room.as_mut_ptr(), self.batch)
        };
        match found {
            u64::MAX => None,
            index => Some(index as u32),
        }
    }
}

unsafe extern "C" {
    fn Bun__JSArray__nextPresentIndexListed(
        value: JSValue,
        start: u32,
        list: &mut PresentIndexList,
        room: *mut u32,
        capacity: u32,
    ) -> u64;
    safe fn Bun__JSArray__getContiguousVector(value: JSValue, out_len: &mut u32) -> *const JSValue;
    // safe: by-value `JSValue`/`u32`; `elements` is only pointer-compared against
    // the array's current butterfly storage (bindings.cpp `== expected`), never
    // dereferenced — no validity precondition.
    safe fn Bun__JSArray__contiguousVectorIsStillValid(
        value: JSValue,
        elements: *const JSValue,
        len: u32,
    ) -> bool;
}
