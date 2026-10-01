// Ids of frozen files. A file owns whole pages of the process's id space, the same pages in every id space
// (nodes, lists, symbols, symbol tables, flow nodes, flow lists), so one page table finds the file of any id and
// a file keeps its ids in every program that uses it, whatever the other files are and whatever their order is.
use crate::ast::table::NodeTable;
use crate::ids::{PAGE_SHIFT, PAGE_SIZE, SYNTH};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub struct IdAllocator {
    next_page: AtomicU32,
}

// The allocator of the process. Page 0 is never given out: id 0 is nil.
pub static PROCESS_IDS: IdAllocator = IdAllocator::new();

impl IdAllocator {
    pub const fn new() -> Self {
        Self {
            next_page: AtomicU32::new(1),
        }
    }
    // The first id of a fresh block of at least `ids` ids, or None when the space below bit 31 is used up.
    pub fn alloc(&self, ids: u32) -> Option<u32> {
        let pages = ids.max(1).div_ceil(PAGE_SIZE);
        let limit = SYNTH >> PAGE_SHIFT;
        let mut current = self.next_page.load(Ordering::Relaxed);
        loop {
            let next = current.checked_add(pages).filter(|n| *n <= limit)?;
            match self.next_page.compare_exchange_weak(
                current,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(current << PAGE_SHIFT),
                Err(seen) => current = seen,
            }
        }
    }
    pub fn pages_used(&self) -> u32 {
        self.next_page.load(Ordering::Relaxed)
    }
}

// Ends the binding of a file: gives it its block and turns every local id into a global one.
// False on exhaustion: the table stays as it was, local and not frozen.
pub fn freeze(table: &mut NodeTable, ids: &IdAllocator) -> bool {
    if table.frozen {
        return true;
    }
    match ids.alloc(table.id_count()) {
        Some(base) => {
            table.rebase(base);
            true
        }
        None => false,
    }
}

static NEXT_SYMBOL_ID: AtomicU64 = AtomicU64::new(0);

// ast.GetSymbolId for a symbol that has no number yet: the next number of the process (utilities.go:34).
// The binder keeps it in SymbolRec::lazy_id, a checker keeps it in its own table.
pub fn next_symbol_id() -> u64 {
    NEXT_SYMBOL_ID.fetch_add(1, Ordering::Relaxed) + 1
}
