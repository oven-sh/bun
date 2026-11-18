use core::cell::Cell;

struct Many {
    cells: Vec<usize>,
    /// So many have survived a collection.
    old_count: usize,
}

/// The addresses of some cells, in one word unless there are several.
#[derive(Default)]
#[repr(transparent)]
pub(super) struct CellList(Cell<usize>);

const IS_SINGLE: usize = 1;

impl CellList {
    #[inline(always)]
    pub(super) fn is_empty(&self) -> bool {
        self.0.get() == 0
    }

    #[inline(always)]
    fn take_many(&self) -> Option<Box<Many>> {
        let word = self.0.get();
        // SAFETY: from `put_many`, and forgotten by the list.
        (word != 0 && word & IS_SINGLE == 0).then(|| unsafe {
            Box::from_raw(core::ptr::with_exposed_provenance_mut(self.0.take()))
        })
    }

    #[inline(always)]
    fn put_many(&self, many: Box<Many>) {
        self.0.set(Box::into_raw(many).expose_provenance());
    }

    #[inline]
    pub(super) fn push(&self, cell: usize) {
        if self.is_empty() {
            return self.0.set(cell | IS_SINGLE);
        }
        let mut many = self.take_many().unwrap_or_else(|| {
            let mut cells = Vec::with_capacity(4);
            cells.push(self.0.get() & !IS_SINGLE);
            Box::new(Many {
                cells,
                old_count: 0,
            })
        });
        many.cells.push(cell);
        self.put_many(many);
    }

    /// Returns how many there are. `visit` does not see the list.
    pub(super) fn for_each(&self, mut visit: impl FnMut(usize)) -> usize {
        match self.take_many() {
            Some(many) => {
                many.cells.iter().copied().for_each(visit);
                let count = many.cells.len();
                self.put_many(many);
                count
            }
            None if self.is_empty() => 0,
            None => {
                visit(self.0.get() & !IS_SINGLE);
                1
            }
        }
    }

    /// After a collection. `old_survive`: it has only looked at new cells.
    pub(super) fn prune(&self, old_survive: bool, survives: impl Fn(usize) -> bool) {
        let Some(mut many) = self.take_many() else {
            if !self.is_empty() && !survives(self.0.get() & !IS_SINGLE) {
                self.0.set(0);
            }
            return;
        };
        let first = if old_survive { many.old_count } else { 0 };
        many.cells
            .extract_if(first.., |&mut cell| !survives(cell))
            .for_each(drop);
        match *many.cells {
            [] => {}
            [cell] => self.0.set(cell | IS_SINGLE),
            _ => {
                many.old_count = many.cells.len();
                if many.cells.len() * 4 < many.cells.capacity() {
                    many.cells.shrink_to(many.old_count * 2);
                }
                self.put_many(many);
            }
        }
    }

    pub(super) fn clear(&self) {
        drop(self.take_many());
        self.0.set(0);
    }
}

impl Drop for CellList {
    fn drop(&mut self) {
        self.clear();
    }
}
