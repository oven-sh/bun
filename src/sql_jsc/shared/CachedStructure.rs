use core::mem::{ManuallyDrop, MaybeUninit};

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSObject, JSValue};
use bun_sql::shared::ColumnIdentifier;

#[derive(Default)]
pub struct CachedStructure {
    /// Raw `JSC::Structure*`. Not a GC root: kept alive by the owning
    /// Connection wrapper's `m_cachedStructures` array (visited in
    /// `visitChildren`), so it is valid only while that wrapper is live.
    pub structure: JSValue,
    /// only populated if more than jsc.JSC__JSObject__maxInlineCapacity fields otherwise the structure will contain all fields inlined
    pub fields: Option<Box<[ExternColumnIdentifier]>>,
}

impl CachedStructure {
    pub fn has(&self) -> bool {
        !self.structure.is_empty() || self.fields.is_some()
    }

    pub fn js_value(&self) -> Option<JSValue> {
        if self.structure.is_empty() {
            None
        } else {
            Some(self.structure)
        }
    }

    pub fn set(
        &mut self,
        _global_object: &JSGlobalObject,
        value: Option<JSValue>,
        fields: Option<Box<[ExternColumnIdentifier]>>,
    ) {
        if let Some(v) = value {
            self.structure = v;
        }
        self.fields = fields;
    }

    /// Populate this `CachedStructure` from a column-identifier sequence —
    /// the shared body of `{Postgres,MySQL}SQLStatement::structure()`.
    ///
    /// Builds an `ExternColumnIdentifier` array on the stack when the
    /// non-duplicate count fits in `JSObject::max_inline_capacity()` (then
    /// bakes it into a JSC `Structure`), otherwise heap-allocates and stores
    /// the boxed slice on `self.fields`. Duplicates are skipped. Callers must
    /// have already run their `check_for_duplicate_fields()` pass so that
    /// `ColumnIdentifier::Duplicate` tags are present.
    ///
    /// `columns` is iterated twice (count + build), hence the `Clone` bound;
    /// `slice.iter().map(..)` satisfies it without allocation.
    pub fn build_from_columns<'a, I>(
        &mut self,
        global_object: &JSGlobalObject,
        owner: JSValue,
        columns: I,
    ) where
        I: Iterator<Item = &'a ColumnIdentifier> + Clone,
    {
        // lets avoid most allocations
        // SAFETY: `[MaybeUninit<T>; N]` is always sound to `assume_init` — every
        // element is itself `MaybeUninit` and thus has no validity invariant.
        let mut stack_ids: [MaybeUninit<ExternColumnIdentifier>; 70] =
            unsafe { MaybeUninit::uninit().assume_init() };
        // lets de duplicate the fields early
        let non_duplicated_count = columns
            .clone()
            .filter(|c| !matches!(c, ColumnIdentifier::Duplicate))
            .count();

        let max_inline = JSObject::max_inline_capacity() as usize;
        // Initialized to empty so the `> max_inline` branch below can
        // unconditionally `into_boxed_slice()` it; in the `<= max_inline`
        // branch it stays empty and is never read.
        let mut heap_ids: Vec<ExternColumnIdentifier> = Vec::new();
        let ids: &mut [MaybeUninit<ExternColumnIdentifier>] = if non_duplicated_count <= max_inline
        {
            &mut stack_ids[..non_duplicated_count]
        } else {
            heap_ids = Vec::with_capacity(non_duplicated_count);
            // Spare capacity is exactly the uninitialized `[MaybeUninit<T>]` view
            // we need; fully initialized in the loop below before any read.
            &mut heap_ids.spare_capacity_mut()[..non_duplicated_count]
        };

        let mut i: usize = 0;
        for name_or_index in columns {
            if matches!(name_or_index, ColumnIdentifier::Duplicate) {
                continue;
            }

            let mut out = ExternColumnIdentifier::default();
            match name_or_index {
                ColumnIdentifier::Name(name) => {
                    out.value.name =
                        ManuallyDrop::new(bun_core::String::create_atom_if_possible(name.slice()));
                }
                ColumnIdentifier::Index(index) => {
                    out.value.index = *index;
                }
                ColumnIdentifier::Duplicate => unreachable!(),
            }
            out.tag = match name_or_index {
                ColumnIdentifier::Name(_) => 2,
                ColumnIdentifier::Index(_) => 1,
                ColumnIdentifier::Duplicate => 0,
            };
            ids[i].write(out);
            i += 1;
        }

        if non_duplicated_count > max_inline {
            // SAFETY: `heap_ids` has capacity `non_duplicated_count` and every
            // slot in [0..non_duplicated_count] was initialized in the loop above.
            unsafe { heap_ids.set_len(non_duplicated_count) };
            // Ownership transfer of heap `ids` to CachedStructure, which
            // becomes responsible for freeing the alloc'd slice.
            self.set(global_object, None, Some(heap_ids.into_boxed_slice()));
        } else {
            // Every element in `ids[..]` was `.write()`n above; C++ reads them as
            // `ExternColumnIdentifier` by raw pointer, so pass the buffer through
            // without materialising a typed slice (avoids an unsafe assume-init cast).
            // SAFETY: every `ids[..len]` slot was initialized in the loop
            // above; the stack buffer outlives the FFI call.
            let structure = unsafe {
                JSObject::create_structure(
                    global_object,
                    owner,
                    ids.len() as u32,
                    ids.as_mut_ptr().cast::<ExternColumnIdentifier>(),
                )
            };
            self.set(global_object, Some(structure), None);
        }
    }
}

// No explicit `impl Drop` is needed: `structure` is a raw `JSValue` (GC-traced
// via the owning Connection wrapper, not here), and the field array is freed
// by `Drop` on `Box<[ExternColumnIdentifier]>`.
