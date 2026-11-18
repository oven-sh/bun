//! The atoms of a thread. The table holds no references: an atom leaves it when its last reference goes.

use core::cell::RefCell;

use crate::static_names::{ATOM_SLOTS, ATOMS};
use crate::{
    AllocError, CodeUnit, StringImpl, StringRef, Text, home_slot, parse_array_index, with_text,
};

/// The address of an atom under the high 16 bits of its hash, which spare most probes a look at the string.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Slot(u64);

impl Slot {
    const EMPTY: Slot = Slot(0);
    const DELETED: Slot = Slot(1);
    const TAG_SHIFT: u32 = 48;

    #[inline(always)]
    fn tag(hash: u32) -> u64 {
        u64::from(hash >> 8)
    }

    #[inline(always)]
    fn new(atom: &StringImpl) -> Slot {
        let address = core::ptr::from_ref(atom).expose_provenance() as u64;
        debug_assert!(address >> Self::TAG_SHIFT == 0);
        Slot(Self::tag(atom.existing_hash()) << Self::TAG_SHIFT | address)
    }

    #[inline(always)]
    fn atom(&self) -> Option<&StringImpl> {
        let address = (self.0 & ((1 << Self::TAG_SHIFT) - 1)) as usize;
        // SAFETY: an atom is taken out of the table before it is freed.
        (address > 1).then(|| unsafe { &*core::ptr::with_exposed_provenance(address) })
    }
}

struct AtomTable {
    /// Empty until the thread asks for an atom.
    slots: Vec<Slot>,
    live: usize,
    deleted: usize,
}

impl AtomTable {
    const UNUSED: AtomTable = AtomTable {
        slots: Vec::new(),
        live: 0,
        deleted: 0,
    };

    #[cold]
    #[inline(never)]
    fn start(&mut self) {
        // Too late if the thread is ending: then the table is left behind.
        _ = END_OF_THREAD.try_with(|_| ());
        let slots = ATOM_SLOTS.iter().map(|&seed| match seed & 0xffff {
            0 => Slot::EMPTY,
            index => {
                let address = ATOMS[index as usize - 1]
                    .as_ptr()
                    .as_ptr()
                    .expose_provenance();
                Slot(u64::from(seed >> 16) << Slot::TAG_SHIFT | address as u64)
            }
        });
        self.slots = slots.collect();
        self.live = ATOMS.len();
    }

    /// The atom, or the slot to put it in.
    #[inline(always)]
    fn find<T: CodeUnit>(&self, units: &[T], hash: u32) -> Result<&StringImpl, usize> {
        let mask = self.slots.len() - 1;
        let tag = Slot::tag(hash);
        let mut index = home_slot(hash, mask);
        let mut reusable = None;
        loop {
            let slot = &self.slots[index];
            if slot.0 >> Slot::TAG_SHIFT == tag
                && let Some(atom) = slot.atom()
                && atom.text() == T::text(units)
            {
                return Ok(atom);
            }
            if *slot == Slot::EMPTY {
                return Err(reusable.unwrap_or(index));
            }
            if *slot == Slot::DELETED && reusable.is_none() {
                reusable = Some(index);
            }
            index = (index + 1) & mask;
        }
    }

    /// `atom` has no hash or the right one.
    #[inline(never)]
    fn insert(&mut self, mut index: usize, atom: &StringImpl, hash: u32) -> Result<(), AllocError> {
        let (used, capacity) = (self.live + self.deleted + 1, self.slots.len());
        if used * 3 > capacity * 2 {
            match self.rehash() {
                Ok(()) => index = first_empty(&self.slots, hash),
                Err(AllocError) if self.slots[index] == Slot::DELETED => {}
                Err(AllocError) if used * 8 <= capacity * 7 => {}
                Err(AllocError) => return Err(AllocError),
            }
        }
        if atom.existing_hash() == 0 {
            atom.set_hash(hash);
        }
        atom.mark_as_atom(parse_array_index(atom.text()).is_some());
        if self.slots[index] == Slot::DELETED {
            self.deleted -= 1;
        }
        self.slots[index] = Slot::new(atom);
        self.live += 1;
        Ok(())
    }

    fn remove(&mut self, atom: &StringImpl) {
        let mask = self.slots.len() - 1;
        let wanted = Slot::new(atom);
        let mut index = home_slot(atom.existing_hash(), mask);
        while self.slots[index] != wanted {
            assert!(
                self.slots[index] != Slot::EMPTY,
                "an atom was released on another thread than its own"
            );
            index = (index + 1) & mask;
        }
        self.live -= 1;
        if self.slots[(index + 1) & mask] == Slot::EMPTY {
            self.slots[index] = Slot::EMPTY;
        } else {
            self.slots[index] = Slot::DELETED;
            self.deleted += 1;
        }
        if self.live * 16 < self.slots.len() && self.slots.len() > ATOM_SLOTS.len() {
            _ = self.rehash();
        }
    }

    #[cold]
    fn rehash(&mut self) -> Result<(), AllocError> {
        let capacity = (self.live * 3).next_power_of_two().max(ATOM_SLOTS.len());
        let mut slots = Vec::new();
        slots.try_reserve_exact(capacity).map_err(|_| AllocError)?;
        slots.resize(capacity, Slot::EMPTY);
        for slot in &self.slots {
            if let Some(atom) = slot.atom() {
                let index = first_empty(&slots, atom.existing_hash());
                slots[index] = *slot;
            }
        }
        self.slots = slots;
        self.deleted = 0;
        Ok(())
    }
}

#[inline(always)]
fn first_empty(slots: &[Slot], hash: u32) -> usize {
    let mask = slots.len() - 1;
    let mut index = home_slot(hash, mask);
    while slots[index] != Slot::EMPTY {
        index = (index + 1) & mask;
    }
    index
}

#[thread_local]
static TABLE: RefCell<AtomTable> = RefCell::new(AtomTable::UNUSED);

struct EndOfThread;

impl Drop for EndOfThread {
    /// What outlives the thread is an ordinary string from now on.
    fn drop(&mut self) {
        let table = TABLE.replace(AtomTable::UNUSED);
        for atom in table.slots.iter().filter_map(Slot::atom) {
            if !atom.is_static() {
                atom.unmark_as_atom();
            }
        }
    }
}

thread_local! {
    static END_OF_THREAD: EndOfThread = const { EndOfThread };
}

#[inline(always)]
fn with_table<R>(act: impl FnOnce(&mut AtomTable) -> R) -> R {
    let mut table = TABLE.borrow_mut();
    if table.slots.is_empty() {
        table.start();
    }
    act(&mut table)
}

/// The atom with these characters. `create` makes the string if there is none; it has no hash or the right one.
#[inline(always)]
pub(crate) fn add(
    text: Text<'_>,
    hash: u32,
    create: impl FnOnce() -> Result<StringRef, AllocError>,
) -> Result<StringRef, AllocError> {
    if text.is_empty() {
        return Ok(StringRef::empty());
    }
    with_table(
        #[inline(always)]
        |table| match with_text!(text, |units| table.find(units, hash)) {
            Ok(atom) => Ok(StringRef::retain(atom)),
            Err(index) => {
                let atom = create()?;
                table.insert(index, &atom, hash)?;
                Ok(atom)
            }
        },
    )
}

#[inline(always)]
pub(crate) fn find(text: Text<'_>, hash: u32) -> Option<StringRef> {
    if text.is_empty() {
        return Some(StringRef::empty());
    }
    with_table(
        #[inline(always)]
        |table| {
            let found = with_text!(text, |units| table.find(units, hash));
            found.ok().map(StringRef::retain)
        },
    )
}

pub(crate) fn remove(atom: &StringImpl) {
    with_table(|table| table.remove(atom));
}
