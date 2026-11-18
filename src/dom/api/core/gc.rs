//! What keeps values alive.

use core::ffi::c_void;

use bun_jsc::bindgen::{JsHeap, JsInterface};
use bun_jsc::{JSGlobalObject, JSValue};

use super::node::Node;

unsafe extern "C" {
    safe fn Bun__DOM__barrierThreshold(global: &JSGlobalObject) -> *const u32;
    safe fn Bun__DOM__vm(global: &JSGlobalObject) -> *mut c_void;
    fn Bun__DOM__writeBarrier(vm: *mut c_void, cell: *const u8);
    fn Bun__DOM__collections(vm: *mut c_void) -> u32;
    safe fn Bun__DOM__listCreate(global: &JSGlobalObject, capacity: u32) -> JSValue;
    safe fn Bun__DOM__listCopyWithout(
        global: &JSGlobalObject,
        list: JSValue,
        value: JSValue,
    ) -> JSValue;
    safe fn Bun__DOM__listLength(list: JSValue) -> u32;
    fn Bun__DOM__listOfCells(
        global: &JSGlobalObject,
        nodes: *const *const c_void,
        length: u32,
        offset: usize,
    ) -> JSValue;
    safe fn Bun__DOM__listGet(list: JSValue, index: u32) -> JSValue;
    safe fn Bun__DOM__listSet(global: &JSGlobalObject, list: JSValue, index: u32, value: JSValue);
    safe fn Bun__DOM__listPush(global: &JSGlobalObject, list: JSValue, value: JSValue);
    safe fn Bun__DOM__listRemove(global: &JSGlobalObject, list: JSValue, index: u32, count: u32);
    safe fn Bun__DOM__listFind(list: JSValue, value: JSValue, step: u32) -> i32;
    safe fn Bun__DOM__listValueOfKey(list: JSValue, key: JSValue) -> JSValue;
    fn Bun__DOM__listFrom(
        global: &JSGlobalObject,
        length: u32,
        context: *mut c_void,
        at: unsafe extern "C" fn(*mut c_void, u32) -> JSValue,
    ) -> JSValue;
}

/// `JSC::Heap::writeBarrier`
#[derive(Clone, Copy)]
pub(crate) struct Barrier {
    threshold: *const u32,
    vm: *mut c_void,
}

impl Barrier {
    pub(crate) fn new(global: &JSGlobalObject) -> Barrier {
        Barrier {
            threshold: Bun__DOM__barrierThreshold(global),
            vm: Bun__DOM__vm(global),
        }
    }

    /// It changes whenever the collector has found out what is dead.
    pub(super) fn collections(self) -> u32 {
        // SAFETY: the VM outlives what has this.
        unsafe { Bun__DOM__collections(self.vm) }
    }

    /// After `cell` has got a reference to another one.
    #[inline(always)]
    pub(crate) fn written(self, cell: JSValue) {
        const CELL_STATE: usize = 7;
        let cell = cell.encoded() as *const u8;
        // SAFETY: `cell` is a live cell of the VM, which outlives it. Marking threads write the state, a byte at a time.
        unsafe {
            if u32::from(cell.add(CELL_STATE).read_volatile()) <= self.threshold.read() {
                Bun__DOM__writeBarrier(self.vm, cell);
            }
        }
    }
}

#[inline(always)]
pub(crate) fn global_of<'h>(heap: &'h JsHeap<'_>) -> &'h JSGlobalObject {
    // SAFETY: this module and its siblings pass it to what allocates.
    unsafe { heap.global() }
}

/// An array that no script has.
#[derive(Clone, Copy)]
pub(crate) struct List<'a>(JSValue, core::marker::PhantomData<&'a Node>);

impl<'a> List<'a> {
    pub(crate) fn new(heap: &JsHeap<'a>) -> List<'a> {
        List::from_value(Bun__DOM__listCreate(global_of(heap), 0))
    }

    pub(crate) fn with_capacity(heap: &JsHeap<'a>, capacity: u32) -> List<'a> {
        List::from_value(Bun__DOM__listCreate(global_of(heap), capacity))
    }

    /// `at` runs no script.
    pub(crate) fn from_fn<F: FnMut(u32) -> JSValue>(
        heap: &JsHeap<'a>,
        length: u32,
        mut at: F,
    ) -> List<'a> {
        unsafe extern "C" fn call<F: FnMut(u32) -> JSValue>(
            context: *mut c_void,
            index: u32,
        ) -> JSValue {
            // SAFETY: what is passed below.
            unsafe { (*context.cast::<F>())(index) }
        }
        // SAFETY: `at` outlives the call.
        List::from_value(unsafe {
            Bun__DOM__listFrom(global_of(heap), length, (&raw mut at).cast(), call::<F>)
        })
    }

    /// # Safety
    /// They point to nodes that are alive.
    pub(crate) unsafe fn from_pointers(heap: &JsHeap<'a>, nodes: &[*const Node]) -> List<'a> {
        // SAFETY: the caller's contract.
        let offset = nodes
            .first()
            .map_or(0, |it| it.addr() - unsafe { &**it }.to_js().encoded());
        // SAFETY: the pointer and the length are of one slice, and all nodes are at the same offset in their cells.
        List::from_value(unsafe {
            Bun__DOM__listOfCells(
                global_of(heap),
                nodes.as_ptr().cast(),
                nodes.len() as u32,
                offset,
            )
        })
    }

    pub(crate) fn from_nodes<'n>(
        heap: &JsHeap<'a>,
        nodes: impl IntoIterator<Item = &'n Node>,
    ) -> List<'a> {
        let list = List::new(heap);
        nodes.into_iter().for_each(|it| list.push(heap, it.to_js()));
        list
    }

    /// With room for one more.
    pub(crate) fn copy_without<'b>(self, heap: &JsHeap<'b>, value: JSValue) -> List<'b> {
        List::from_value(Bun__DOM__listCopyWithout(global_of(heap), self.0, value))
    }

    /// Of what `to_js` has answered.
    #[inline(always)]
    pub(crate) fn from_value(value: JSValue) -> List<'a> {
        List(value, core::marker::PhantomData)
    }

    /// Empty if that is not an array.
    pub(crate) fn from_script(heap: &JsHeap<'a>, value: JSValue) -> List<'a> {
        if value.is_array() {
            List::from_value(value)
        } else {
            List::new(heap)
        }
    }

    #[inline(always)]
    pub(crate) fn to_js(self) -> JSValue {
        self.0
    }

    /// Until it changes. `None` if they are stored in another way.
    #[inline(always)]
    pub(super) fn contiguous(&self) -> Option<&[JSValue]> {
        const INDEXING_TYPE: usize = 4;
        const BUTTERFLY: usize = 8;
        let cell = self.0.encoded() as *const *const JSValue;
        // SAFETY: it is an array. The length comes before the values.
        unsafe {
            (cell.cast::<u8>().add(INDEXING_TYPE).read_volatile() & 0x0e == 0x08).then(|| {
                let values = cell.byte_add(BUTTERFLY).read();
                core::slice::from_raw_parts(values, values.cast::<u32>().sub(2).read() as usize)
            })
        }
    }

    #[inline]
    pub(crate) fn len(self) -> u32 {
        self.contiguous()
            .map_or_else(|| Bun__DOM__listLength(self.0), |it| it.len() as u32)
    }

    pub(crate) fn is_empty(self) -> bool {
        self.len() == 0
    }

    /// The empty value after the end.
    #[inline]
    pub(crate) fn get(self, index: u32) -> JSValue {
        self.contiguous().map_or_else(
            || Bun__DOM__listGet(self.0, index),
            |it| it.get(index as usize).copied().unwrap_or_default(),
        )
    }

    pub(crate) fn set(self, heap: &JsHeap<'_>, index: u32, value: JSValue) {
        Bun__DOM__listSet(global_of(heap), self.0, index, value);
    }

    pub(crate) fn push(self, heap: &JsHeap<'_>, value: JSValue) {
        Bun__DOM__listPush(global_of(heap), self.0, value);
    }

    pub(crate) fn insert(self, heap: &JsHeap<'_>, index: u32, value: JSValue) {
        self.push(heap, value);
        (index + 1..self.len())
            .rev()
            .for_each(|it| self.set(heap, it, self.get(it - 1)));
        self.set(heap, index, value);
    }

    pub(crate) fn position(self, value: JSValue) -> Option<u32> {
        u32::try_from(Bun__DOM__listFind(self.0, value, 1)).ok()
    }

    /// Among those with an even index.
    pub(crate) fn position_of_key(self, key: JSValue) -> Option<u32> {
        u32::try_from(Bun__DOM__listFind(self.0, key, 2)).ok()
    }

    /// What follows it.
    #[inline]
    pub(crate) fn value_of_key(self, key: JSValue) -> Option<JSValue> {
        let found = match self.contiguous() {
            Some(all) => all.as_chunks().0.iter().find(|[it, _]| *it == key)?[1],
            None => Bun__DOM__listValueOfKey(self.0, key),
        };
        Some(found).filter(|it| !it.is_empty())
    }

    pub(crate) fn contains(self, value: JSValue) -> bool {
        self.position(value).is_some()
    }

    pub(crate) fn remove_range(self, heap: &JsHeap<'_>, index: u32, count: u32) {
        Bun__DOM__listRemove(global_of(heap), self.0, index, count);
    }

    pub(crate) fn remove(self, heap: &JsHeap<'_>, value: JSValue) -> bool {
        self.position(value)
            .map(|it| self.remove_range(heap, it, 1))
            .is_some()
    }

    pub(crate) fn clear(self, heap: &JsHeap<'_>) {
        self.remove_range(heap, 0, self.len());
    }

    /// It sees what is added meanwhile.
    pub(crate) fn values(self) -> impl Iterator<Item = JSValue> {
        (0..)
            .map(move |it| self.get(it))
            .take_while(|it| !it.is_empty())
    }

    pub(crate) fn node(self, index: u32) -> Option<&'a Node> {
        // SAFETY: the list holds it.
        Some(self.get(index))
            .filter(|it| Node::is(*it))
            .map(|it| unsafe { Node::from_cell(it) })
    }

    pub(crate) fn nodes(self) -> impl Iterator<Item = &'a Node> {
        (0..).map_while(move |it| self.node(it))
    }
}

/// Nodes, for a local variable.
#[derive(Default)]
pub(crate) struct Rooted<'a> {
    first: [Option<&'a Node>; 4],
    rest: Option<List<'a>>,
    len: u32,
}

impl<'a> Rooted<'a> {
    #[inline]
    pub(crate) fn push(&mut self, heap: &JsHeap<'a>, node: &'a Node) {
        match self.first.get_mut(self.len as usize) {
            Some(slot) => *slot = Some(node),
            None => self
                .rest
                .get_or_insert_with(|| List::new(heap))
                .push(heap, node.to_js()),
        }
        self.len += 1;
    }

    pub(crate) fn from_nodes(
        heap: &JsHeap<'a>,
        nodes: impl IntoIterator<Item = &'a Node>,
    ) -> Rooted<'a> {
        let mut all = Rooted::default();
        nodes.into_iter().for_each(|it| all.push(heap, it));
        all
    }

    #[inline]
    pub(crate) fn get(&self, index: u32) -> Option<&'a Node> {
        match self.first.get(index as usize) {
            Some(node) => *node,
            None => self.rest?.node(index - self.first.len() as u32),
        }
    }

    #[inline]
    pub(crate) fn len(&self) -> u32 {
        self.len
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &'a Node> + '_ {
        (0..self.len).map_while(|it| self.get(it))
    }

    pub(crate) fn contains(&self, node: &Node) -> bool {
        self.iter().any(|it| it == node)
    }

    pub(crate) fn to_list(&self, heap: &JsHeap<'a>) -> List<'a> {
        List::from_fn(heap, self.len, |it| {
            self.get(it).map_or(JSValue::NULL, Node::to_js)
        })
    }
}
