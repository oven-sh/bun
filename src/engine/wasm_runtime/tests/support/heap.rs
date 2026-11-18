//! A small collector: generational, conservative on the stack, and eager to spoil what it frees.

use std::alloc::{Layout, alloc_zeroed, dealloc};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::mem::offset_of;
use std::num::NonZeroUsize;
use std::ptr;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};

use bun_engine_wasm_compiler::abi::{AllocatorLayout, Callable, HostLayout, ObjectType, object};
use bun_engine_wasm_format::CanonicalType;
use bun_engine_wasm_runtime::{Engine, HostCell, Instance, Owned, Reference, Tag, find_references};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum Kind {
    Instance = 1,
    Object,
    Function,
    Exception,
    Owner,
    TypeData,
    Opaque,
}

const KIND: i32 = 5;
const STATE: i32 = 7;
/// What the cell owns, or the number of an opaque cell.
const PRIVATE: i32 = 8;
const OLD: u8 = 0;
const YOUNG: u8 = 1;
const REMEMBERED: u8 = 2;

pub(crate) static BARRIER_THRESHOLD: AtomicU8 = AtomicU8::new(OLD);

const SPOILED: u8 = 0xdb;
const SPOILED_AT_MOST: usize = 1 << 20;

const CLASS_OF_STEP: [u8; 17] = [0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7];
const CELL_SIZES: [u32; 8] = [16, 32, 48, 64, 96, 128, 192, 256];

#[repr(C)]
struct TypeRecord {
    ty: ObjectType,
    cell: HostCell,
}

/// Room for those of all heaps. No number is used twice.
static TYPE_RECORDS: LazyLock<usize> = LazyLock::new(|| {
    let layout = Layout::array::<TypeRecord>(1 << 22).unwrap();
    // SAFETY: not empty.
    unsafe { alloc_zeroed(layout) }.expose_provenance()
});
static TYPE_COUNT: AtomicU32 = AtomicU32::new(1);

fn type_record(number: u32) -> *mut TypeRecord {
    ptr::with_exposed_provenance_mut(*TYPE_RECORDS + number as usize)
}

/// What the cell for a type owns.
struct TypeData {
    ty: CanonicalType,
    supertype: Option<HostCell>,
}

#[repr(C)]
pub(crate) struct Allocator {
    /// Where the cells start that the heap does not know yet.
    first: Cell<usize>,
    cell_size: u32,
    end: Cell<usize>,
    start: Cell<usize>,
    _padding: usize,
}

pub(crate) type Allocators = [Allocator; CELL_SIZES.len()];

pub(crate) fn allocators() -> Allocators {
    CELL_SIZES.map(|cell_size| Allocator {
        first: Cell::new(0),
        cell_size,
        end: Cell::new(0),
        start: Cell::new(0),
        _padding: 0,
    })
}

pub(crate) fn take_free_cell(allocators: &Allocators, size: usize) -> Option<HostCell> {
    let allocator = &allocators[usize::from(*CLASS_OF_STEP.get(size.div_ceil(16))?)];
    let cell = Some(allocator.start.get()).filter(|&it| it < allocator.end.get())?;
    allocator.start.set(cell + allocator.cell_size as usize);
    NonZeroUsize::new(cell).map(HostCell)
}

pub(crate) fn layout(vm_top_frame: i32) -> HostLayout {
    HostLayout {
        instance_header_size: 16,
        cell_kind: KIND,
        object_kind: Kind::Object as u8,
        cell_state: STATE,
        barrier_threshold_address: BARRIER_THRESHOLD.as_ptr().expose_provenance(),
        object_types: *TYPE_RECORDS,
        allocators: AllocatorLayout {
            stride: size_of::<Allocator>() as u32,
            start: offset_of!(Allocator, start) as i32,
            end: offset_of!(Allocator, end) as i32,
            cell_size: offset_of!(Allocator, cell_size) as i32,
            class_of_step: &CLASS_OF_STEP,
        },
        function_callable: 8,
        exception_tag: 16,
        exception_payload: 24,
        vm_top_frame,
        null_guard_size: 0,
    }
}

fn field<T>(cell: HostCell, offset: i32) -> *mut T {
    ptr::with_exposed_provenance_mut(cell.address() + offset as usize)
}

pub(crate) fn kind_of(cell: HostCell) -> Kind {
    // SAFETY: the tests ask about live cells.
    unsafe { field::<Kind>(cell, KIND).read() }
}

pub(crate) fn private_word(cell: HostCell) -> usize {
    // SAFETY: as above.
    unsafe { field::<usize>(cell, PRIVATE).read() }
}

/// # Safety
/// The cell owns a `T`, and lives for `'a`.
pub(crate) unsafe fn owned<'a, T>(cell: HostCell) -> &'a T {
    // SAFETY: the caller's.
    unsafe { &*ptr::with_exposed_provenance(private_word(cell)) }
}

const ALIGNMENT: usize = 16;

#[derive(Default)]
pub(crate) struct Heap {
    /// Without it cells stay until the heap is dropped.
    pub(crate) collects: bool,
    /// Hands out the same cells again and again, to measure programs that drop objects soon.
    pub(crate) recycles: bool,
    sizes: BTreeMap<usize, usize>,
    /// What came from the system allocator: the size, and how many cells in it are alive or may yet be taken.
    chunks: BTreeMap<usize, (usize, usize)>,
    /// The headers, by the address of the `Rtt`.
    types: BTreeMap<usize, u64>,
    remembered: Vec<HostCell>,
    spoiled: Vec<(usize, usize)>,
    pub(crate) freed: usize,
}

fn free_spoiled((start, size): (usize, usize)) {
    // SAFETY: from `new_chunk`.
    let bytes = unsafe { std::slice::from_raw_parts(ptr::with_exposed_provenance(start), size) };
    let is_untouched = bytes
        .iter()
        .take(SPOILED_AT_MOST)
        .all(|&it: &u8| it == SPOILED);
    assert!(is_untouched, "a cell was written after it was freed");
    free((start, size));
}

fn free((start, size): (usize, usize)) {
    let layout = Layout::from_size_align(size, ALIGNMENT).unwrap();
    // SAFETY: from `new_chunk`.
    unsafe { dealloc(ptr::with_exposed_provenance_mut(start), layout) };
}

impl Heap {
    fn new_chunk(&mut self, cell_size: usize, cells: usize) -> Option<usize> {
        let layout = Layout::from_size_align(cell_size * cells, ALIGNMENT).ok()?;
        // SAFETY: no cell is empty.
        let start = unsafe { alloc_zeroed(layout) }.expose_provenance();
        (start != 0).then(|| self.chunks.insert(start, (layout.size(), cells)))?;
        Some(start)
    }

    fn release_cells(&mut self, address: usize, count: usize) {
        const KEPT_SPOILED: usize = 1 << 14;
        let (&start, (size, cells)) = self.chunks.range_mut(..=address).next_back().unwrap();
        *cells -= count;
        if *cells == 0 {
            self.spoiled.push((start, *size));
            self.chunks.remove(&start);
        }
        if self.spoiled.len() == 2 * KEPT_SPOILED {
            self.spoiled.drain(..KEPT_SPOILED).for_each(free_spoiled);
        }
    }

    pub(crate) fn new_cell(&mut self, kind: Kind, size: usize, private: usize) -> Option<HostCell> {
        let size = size.next_multiple_of(8);
        let cell = HostCell(NonZeroUsize::new(self.new_chunk(size, 1)?)?);
        self.sizes.insert(cell.address(), size);
        // SAFETY: every cell has two words.
        unsafe {
            field::<Kind>(cell, KIND).write(kind);
            field::<u8>(cell, STATE).write(YOUNG);
            field::<usize>(cell, PRIVATE).write(private);
        }
        Some(cell)
    }

    /// From now on the heap knows the cells that were taken.
    fn stop_allocating(&mut self, allocator: &Allocator) {
        let (first, start, end) = (
            allocator.first.take(),
            allocator.start.take(),
            allocator.end.take(),
        );
        let size = allocator.cell_size as usize;
        assert!(start <= end && (start - first).is_multiple_of(size));
        if self.collects {
            self.sizes
                .extend((first..start).step_by(size).map(|cell| (cell, size)));
            if start != end {
                self.release_cells(first, (end - start) / size);
            }
        }
    }

    pub(crate) fn allocate_object(
        &mut self,
        allocators: &Allocators,
        size: usize,
    ) -> Option<HostCell> {
        let class = CLASS_OF_STEP.get(size.div_ceil(16));
        let allocator = class.map(|&class| &allocators[usize::from(class)]);
        let cell_size = allocator.map_or(size, |it| it.cell_size as usize);
        if let Some(allocator) = allocator.filter(|it| self.recycles && it.first.get() != 0) {
            allocator.start.set(allocator.first.get() + cell_size);
            return NonZeroUsize::new(allocator.first.get()).map(HostCell);
        }
        let cells = match allocator {
            None => 1,
            Some(_) if self.collects => 3,
            Some(_) => 1 << 12,
        };
        let start = self.new_chunk(cell_size, cells)?;
        let bytes = ptr::with_exposed_provenance_mut::<u8>(start);
        // SAFETY: the new chunk.
        unsafe { bytes.write_bytes(SPOILED, (cell_size * cells).min(SPOILED_AT_MOST)) };
        if let Some(allocator) = allocator {
            self.stop_allocating(allocator);
            allocator.first.set(start);
            allocator.start.set(start + cell_size);
            allocator.end.set(start + cell_size * cells);
        } else {
            self.sizes.insert(start, cell_size);
        }
        NonZeroUsize::new(start).map(HostCell)
    }

    pub(crate) fn object_type(
        &mut self,
        ty: CanonicalType,
        supertype: Option<u64>,
    ) -> Option<(u64, HostCell)> {
        let rtt = ty.rtt().address();
        if let Some(&header) = self.types.get(&rtt) {
            // SAFETY: written below.
            return Some((header, unsafe { (*type_record(header as u32)).cell }));
        }
        let number = TYPE_COUNT.fetch_add(1, Ordering::Relaxed) * size_of::<TypeRecord>() as u32;
        // SAFETY: as above.
        let supertype = supertype.map(|header| unsafe { &*type_record(header as u32) });
        let record = ObjectType::new(number, ty.rtt(), supertype.map(|it| &it.ty));
        let supertype = supertype.map(|it| it.cell);
        let cell = self.new_owner(Kind::TypeData, 16, TypeData { ty, supertype })?;
        // SAFETY: nobody else has the number.
        unsafe { type_record(number).write(TypeRecord { ty: record, cell }) };
        let header = u64::from(number)
            | (Kind::Object as u64) << (8 * KIND)
            | u64::from(YOUNG) << (8 * STATE);
        self.types.insert(rtt, header);
        Some((header, cell))
    }

    pub(crate) fn new_owner<T>(&mut self, kind: Kind, size: usize, value: T) -> Option<HostCell> {
        let owned = Box::into_raw(Box::new(value)).expose_provenance();
        self.new_cell(kind, size, owned)
    }

    pub(crate) fn remember(&mut self, cell: HostCell) {
        let state = field::<u8>(cell, STATE);
        // SAFETY: a live cell.
        unsafe {
            if state.read() == OLD {
                state.write(REMEMBERED);
                self.remembered.push(cell);
            }
        }
    }

    pub(crate) fn cell_containing(&self, word: usize) -> Option<HostCell> {
        let (&start, &size) = self.sizes.range(..=word).next_back()?;
        (word < start + size).then(|| HostCell(NonZeroUsize::new(start).unwrap()))
    }

    /// Returns the cells that died, for `destroy`.
    pub(crate) fn mark(
        &mut self,
        engine: &Engine,
        allocators: &Allocators,
        roots: impl Iterator<Item = usize>,
        is_full: bool,
    ) -> Vec<HostCell> {
        allocators.iter().for_each(|it| self.stop_allocating(it));
        let cells = || {
            self.sizes
                .keys()
                .map(|&it| HostCell(NonZeroUsize::new(it).unwrap()))
        };
        let mut pending = std::mem::take(&mut self.remembered);
        if is_full {
            pending.clear();
            // SAFETY: live cells.
            cells().for_each(|cell| unsafe { field::<u8>(cell, STATE).write(YOUNG) });
        }
        pending.extend(roots.filter_map(|word| self.cell_containing(word)));
        while let Some(cell) = pending.pop() {
            // SAFETY: as above.
            if unsafe { field::<u8>(cell, STATE).replace(OLD) } != OLD {
                trace(engine, cell, &mut |referent| {
                    assert!(
                        self.sizes.contains_key(&referent.address()),
                        "a {:?} refers to a cell that was freed",
                        kind_of(cell)
                    );
                    pending.push(referent);
                });
            }
        }
        // SAFETY: as above.
        let is_dead = |&cell: &HostCell| unsafe { field::<u8>(cell, STATE).read() } != OLD;
        cells().filter(is_dead).collect()
    }

    pub(crate) fn destroy(&mut self, engine: &Engine, cell: HostCell) {
        let size = self.sizes.remove(&cell.address()).unwrap();
        // SAFETY: nothing refers to the cell, which owns what its kind says.
        unsafe {
            let drop_box = |drop: unsafe fn(usize)| drop(private_word(cell));
            match kind_of(cell) {
                Kind::Instance => Instance::destroy(engine, cell),
                Kind::Owner => drop_box(drop_owned::<Owned>),
                Kind::TypeData => {
                    let data = owned::<TypeData>(cell);
                    let header = self.types.remove(&data.ty.rtt().address()).unwrap();
                    type_record(header as u32).write_bytes(SPOILED, 1);
                    drop_box(drop_owned::<TypeData>);
                }
                Kind::Object | Kind::Function | Kind::Exception | Kind::Opaque => {}
            }
            field::<u8>(cell, 0).write_bytes(SPOILED, size.min(SPOILED_AT_MOST));
        }
        self.freed += 1;
        self.release_cells(cell.address(), 1);
    }

    pub(crate) fn destroy_all(&mut self, engine: &Engine) {
        while let Some((&address, _)) = self.sizes.first_key_value() {
            self.destroy(engine, HostCell(NonZeroUsize::new(address).unwrap()));
        }
        self.spoiled.drain(..).for_each(free_spoiled);
        for (start, (size, _)) in std::mem::take(&mut self.chunks) {
            free((start, size));
        }
    }
}

unsafe fn drop_owned<T>(address: usize) {
    // SAFETY: from `new_owner`.
    drop(unsafe { Box::from_raw(ptr::with_exposed_provenance_mut::<T>(address)) });
}

fn trace(engine: &Engine, cell: HostCell, visit: &mut dyn FnMut(HostCell)) {
    let layout = engine.layout();
    // SAFETY: the kind tells what is in the cell.
    unsafe {
        let mut visit_field = |offset: i32| {
            let value = Reference(field::<u64>(cell, offset).read());
            value.cell().into_iter().for_each(&mut *visit);
        };
        match kind_of(cell) {
            Kind::Instance => {
                if let Some(instance) = Instance::of_cell(engine, cell) {
                    instance.trace(visit);
                }
            }
            Kind::Object => {
                let record = &*type_record(field::<u32>(cell, object::TYPE_NUMBER).read());
                find_references(cell, &record.ty, |first, count| {
                    let start = (first.addr() - cell.address()) as i32;
                    (0..count as i32).for_each(|index| visit_field(start + index * 8));
                });
                visit(record.cell);
            }
            Kind::Function => visit_field(layout.function_callable + Callable::INSTANCE),
            Kind::Exception => {
                visit_field(PRIVATE);
                let tag = field::<usize>(cell, layout.exception_tag).read();
                for (ty, offset) in (*ptr::with_exposed_provenance::<Tag>(tag)).payload() {
                    if ty.is_ref() {
                        visit_field(layout.exception_payload + offset as i32);
                    }
                }
            }
            Kind::Owner => match owned::<Owned>(cell) {
                Owned::Memory(_) | Owned::Tag(_) => {}
                Owned::Table(table) => table.trace(visit),
                Owned::Global(global) => global.trace(visit),
            },
            Kind::TypeData => owned::<TypeData>(cell)
                .supertype
                .into_iter()
                .for_each(visit),
            Kind::Opaque => {}
        }
    }
}
