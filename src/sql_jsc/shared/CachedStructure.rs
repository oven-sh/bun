use core::ffi::{CStr, c_char};
use core::mem::{ManuallyDrop, MaybeUninit};

use crate::jsc::{
    ExternColumnIdentifier, JSGlobalObject, JSObject, JSValue, JsError, JsResult,
    MarkedArgumentBuffer, StrongOptional, bun_string_jsc,
};
use bun_jsc::Weak;
use bun_ptr::RawSlice;
use bun_sql::shared::{ColumnIdentifier, Data};

#[derive(Default)]
pub struct CachedStructure {
    pub(crate) structure: StrongOptional, // Strong.Optional = .empty
    /// only populated if more than jsc.JSC__JSObject__maxInlineCapacity fields otherwise the structure will contain all fields inlined
    pub(crate) fields: Option<Box<[ExternColumnIdentifier]>>,
    /// `result.statement`, kept alive only by the results that hold it.
    description: Weak<()>,
}

impl CachedStructure {
    pub(crate) fn has(&self) -> bool {
        self.structure.has() || self.fields.is_some()
    }

    pub(crate) fn js_value(&self) -> Option<JSValue> {
        self.structure.get()
    }

    pub(crate) fn description(&self) -> Option<JSValue> {
        self.description.get()
    }

    pub(crate) fn set_description(&mut self, global_object: &JSGlobalObject, description: JSValue) {
        self.description = Weak::create_passive(description, global_object);
    }

    pub(crate) fn clear_description(&mut self) {
        self.description = Weak::default();
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
    /// Builds an `ExternColumnIdentifier` array on the stack when the
    /// non-duplicate count fits in `JSObject::max_inline_capacity()` (then
    /// bakes it into a JSC `Structure`), otherwise heap-allocates and stores
    /// the boxed slice on `self.fields`. Duplicates are skipped. Callers must
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
        // lets avoid most allocations
        let mut stack_ids: [MaybeUninit<ExternColumnIdentifier>; 70] =
            [const { MaybeUninit::uninit() }; 70];
        // lets de duplicate the fields early
        let non_duplicated_count = columns
            .clone()
            .filter(|c| !matches!(c, ColumnIdentifier::Duplicate(_)))
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
            if matches!(name_or_index, ColumnIdentifier::Duplicate(_)) {
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
                ColumnIdentifier::Duplicate(_) => unreachable!(),
            }
            out.tag = match name_or_index {
                ColumnIdentifier::Name(_) => 2,
                ColumnIdentifier::Index(_) => 1,
                ColumnIdentifier::Duplicate(_) => 0,
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
            // SAFETY: every `ids[..len]` slot was initialized in the loop above.
            let ids: &mut [ExternColumnIdentifier] = unsafe { ids.assume_init_mut() };
            // C++ copies each name into an `Identifier`; the stack buffer
            // outlives the call and its atoms are released right after.
            // SAFETY: `owner` is a cell; `ids` is a valid initialized buffer.
            let structure = unsafe {
                JSObject::create_structure(global_object, owner, ids.len() as u32, ids.as_mut_ptr())
            };
            // SAFETY: initialized above; not read again.
            unsafe { core::ptr::drop_in_place(ids) };
            self.set(global_object, Some(structure), None);
        }
    }
}

/// What `result.statement` is made of, for the results of a query whose statement no other query
/// runs: nothing would share the object, so it is made when somebody reads it.
pub(crate) struct Undescribed<T>(Vec<Option<T>>);

impl<T> Default for Undescribed<T> {
    fn default() -> Self {
        Self(Vec::new())
    }
}

impl<T> Undescribed<T> {
    /// Returns the number that gets `result` back from `take`.
    pub(crate) fn push(&mut self, result: T) -> JSValue {
        self.0.push(Some(result));
        JSValue::js_number_from_uint64(self.0.len() as u64 - 1)
    }

    pub(crate) fn take(&mut self, number: JSValue) -> Option<T> {
        let index = usize::try_from(number.to_int32()).ok()?;
        self.0.get_mut(index)?.take()
    }
}

/// Makes `result.statement`. `append_columns` appends a value per key, column after column.
pub(crate) fn describe_statement<const KEYS: usize>(
    global_object: &JSGlobalObject,
    query: &bun_core::String,
    parameter_types: &[u32],
    keys: [&CStr; KEYS],
    append_columns: impl FnOnce(&mut MarkedArgumentBuffer) -> JsResult<()>,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn SQL__createStatementDescription(
            global_object: &JSGlobalObject,
            query: &bun_core::String,
            parameter_types: *const u32,
            parameter_count: usize,
            keys: *const *const c_char,
            key_count: usize,
            column_values: &MarkedArgumentBuffer,
        ) -> JSValue;
    }
    let keys = keys.map(|key| key.as_ptr());
    MarkedArgumentBuffer::new(|column_values| {
        append_columns(column_values)?;
        bun_jsc::host_fn::from_js_host_call(global_object, || {
            // SAFETY: each pointer has as many live elements as the count after it; C++ keeps none.
            unsafe {
                SQL__createStatementDescription(
                    global_object,
                    query,
                    parameter_types.as_ptr(),
                    parameter_types.len(),
                    keys.as_ptr(),
                    KEYS,
                    column_values,
                )
            }
        })
    })
}

pub(crate) fn column_name_to_js(
    global_object: &JSGlobalObject,
    column: &ColumnIdentifier,
) -> JsResult<JSValue> {
    match column {
        ColumnIdentifier::Name(name) | ColumnIdentifier::Duplicate(name) => {
            bun_string_jsc::create_utf8_for_js(global_object, name.slice())
        }
        ColumnIdentifier::Index(index) => {
            let mut digits = bun_core::fmt::ItoaBuf::new();
            bun_string_jsc::create_utf8_for_js(
                global_object,
                bun_core::fmt::itoa(&mut digits, *index),
            )
        }
    }
}

/// Runs user code that can close the connection: hold no reference into it or its statements.
pub(crate) fn transform_name(
    global_object: &JSGlobalObject,
    transform: JSValue,
    name: JSValue,
) -> JsResult<ColumnIdentifier> {
    let renamed = transform
        .call(global_object, JSValue::UNDEFINED, &[name])?
        .to_bun_string(global_object)?;
    let renamed = renamed.to_utf8();
    ColumnIdentifier::init(Data::Temporary(RawSlice::new(renamed.slice())))
        .map_err(|_| JsError::OutOfMemory)
}

// No explicit `impl Drop` is needed: the GC-strong structure handle is freed
// by `impl Drop for StrongOptional`, and the field array (including each
// element's owned name) is freed by `Drop` on `Box<[ExternColumnIdentifier]>`.
