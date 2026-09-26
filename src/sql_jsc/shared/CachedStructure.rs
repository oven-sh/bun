use core::mem::ManuallyDrop;

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSObject, JSValue, StrongOptional};
use bun_sql::shared::ColumnIdentifier;

#[derive(Default)]
pub struct CachedStructure {
    pub(crate) structure: StrongOptional, // Strong.Optional = .empty
    /// only populated if more than jsc.JSC__JSObject__maxInlineCapacity fields otherwise the structure will contain all fields inlined
    pub(crate) fields: Option<Box<[ExternColumnIdentifier]>>,
}

impl CachedStructure {
    pub(crate) fn has(&self) -> bool {
        self.structure.has() || self.fields.is_some()
    }

    pub(crate) fn js_value(&self) -> Option<JSValue> {
        self.structure.get()
    }

    pub(crate) fn set(
        &mut self,
        global_object: &JSGlobalObject,
        value: Option<JSValue>,
        fields: Option<Box<[ExternColumnIdentifier]>>,
    ) {
        if let Some(v) = value {
            self.structure.set(global_object, v);
        }
        self.fields = fields;
    }

    /// Populate this `CachedStructure` from a column-identifier sequence —
    /// the shared body of `{Postgres,MySQL}SQLStatement::structure()`.
    ///
    /// Builds an `ExternColumnIdentifier` array and, when the non-duplicate
    /// count fits in `JSObject::max_inline_capacity()`, bakes it into a JSC
    /// `Structure`; otherwise stores the boxed slice on `self.fields`. Duplicates are skipped. Callers must
    /// have already run their `check_for_duplicate_fields()` pass so that
    /// `ColumnIdentifier::Duplicate` tags are present.
    ///
    /// `columns` is iterated twice (count + build), hence the `Clone` bound;
    /// `slice.iter().map(..)` satisfies it without allocation.
    pub(crate) fn build_from_columns<'a, I>(
        &mut self,
        global_object: &JSGlobalObject,
        owner: JSValue,
        columns: I,
    ) where
        I: Iterator<Item = &'a ColumnIdentifier> + Clone,
    {
        // lets de duplicate the fields early
        let non_duplicated_count = columns
            .clone()
            .filter(|c| !matches!(c, ColumnIdentifier::Duplicate))
            .count();

        let mut ids: Vec<ExternColumnIdentifier> = Vec::with_capacity(non_duplicated_count);
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
            ids.push(out);
        }

        if non_duplicated_count > JSObject::max_inline_capacity() as usize {
            // Ownership transfer of `ids` to CachedStructure, which becomes
            // responsible for freeing the slice.
            self.set(global_object, None, Some(ids.into_boxed_slice()));
        } else {
            // Baked into a JSC `Structure`; C++ copies the names it needs.
            self.set(
                global_object,
                Some(JSObject::create_structure_for(
                    global_object,
                    owner,
                    &mut ids,
                )),
                None,
            );
        }
    }
}

// No explicit `impl Drop` is needed: the GC-strong structure handle is freed
// by `impl Drop for StrongOptional`, and the field array (including each
// element's owned name) is freed by `Drop` on `Box<[ExternColumnIdentifier]>`.
