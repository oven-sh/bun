use core::cell::Cell;
use core::mem::MaybeUninit;

use bun_collections::StringHashMap;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, JSObject};
use bun_str::String;

use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use crate::postgres::signature::Signature;
use crate::postgres::data_cell::{self, SQLDataCell as DataCell};

use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::any_postgres_error::{AnyPostgresError, postgres_error_to_js};
use bun_sql::postgres::postgres_types::int4;

bun_output::declare_scope!(Postgres, visible);

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread refcount.
// Ported as an embedded `Cell<u32>` driven by `bun_ptr::IntrusiveRc<PostgresSQLStatement>`;
// `ref`/`deref` are provided by `IntrusiveRc`, not as inherent methods.
pub struct PostgresSQLStatement {
    pub cached_structure: PostgresCachedStructure,
    pub ref_count: Cell<u32>,
    pub fields: Vec<protocol::FieldDescription>,
    pub parameters: Box<[int4]>,
    pub signature: Signature,
    pub status: Status,
    pub error_response: Option<Error>,
    pub needs_duplicate_check: bool,
    pub fields_flags: data_cell::Flags,
}

impl Default for PostgresSQLStatement {
    fn default() -> Self {
        // TODO(port): `signature` has no default in Zig; callers must set it. This Default
        // exists only to mirror the per-field `= ...` initializers.
        Self {
            cached_structure: PostgresCachedStructure::default(),
            ref_count: Cell::new(1),
            fields: Vec::new(),
            parameters: Box::default(),
            signature: Signature::default(),
            status: Status::Pending,
            error_response: None,
            needs_duplicate_check: true,
            fields_flags: data_cell::Flags::default(),
        }
    }
}

pub enum Error {
    Protocol(protocol::ErrorResponse),
    PostgresError(AnyPostgresError),
}

impl Error {
    // Zig `deinit` only forwarded to `ErrorResponse.deinit()`; that is now `Drop` on
    // `protocol::ErrorResponse`, so no explicit `Drop` impl is needed here.

    pub fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Error::Protocol(err) => err.to_js(global_object),
            Error::PostgresError(err) => postgres_error_to_js(global_object, None, *err),
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Pending,
    Parsing,
    Prepared,
    Failed,
}

impl Status {
    pub fn is_running(self) -> bool {
        self == Status::Parsing
    }
}

impl PostgresSQLStatement {
    pub fn check_for_duplicate_fields(&mut self) {
        if !self.needs_duplicate_check {
            return;
        }
        self.needs_duplicate_check = false;

        let mut seen_numbers: Vec<u32> = Vec::new();
        let mut seen_fields: StringHashMap<()> = StringHashMap::default();
        seen_fields.reserve(self.fields.len());

        // iterate backwards
        let mut remaining = self.fields.len();
        let mut flags = data_cell::Flags::default();
        while remaining > 0 {
            remaining -= 1;
            let field: &mut protocol::FieldDescription = &mut self.fields[remaining];
            match &mut field.name_or_index {
                protocol::NameOrIndex::Name(name) => {
                    // TODO(port): Zig `getOrPut` keys on the borrowed slice; StringHashMap may
                    // need an owned key here. Preserve the "found_existing" semantics.
                    let seen = seen_fields.get_or_put(name.slice());
                    if seen.found_existing {
                        field.name_or_index = protocol::NameOrIndex::Duplicate;
                        flags.has_duplicate_columns = true;
                    }

                    flags.has_named_columns = true;
                }
                protocol::NameOrIndex::Index(index) => {
                    let index = *index;
                    if seen_numbers.iter().position(|&n| n == index).is_some() {
                        field.name_or_index = protocol::NameOrIndex::Duplicate;
                        flags.has_duplicate_columns = true;
                    } else {
                        seen_numbers.push(index);
                    }

                    flags.has_indexed_columns = true;
                }
                protocol::NameOrIndex::Duplicate => {
                    flags.has_duplicate_columns = true;
                }
            }
        }

        self.fields_flags = flags;
    }

    pub fn structure(
        &mut self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> PostgresCachedStructure {
        if self.cached_structure.has() {
            return self.cached_structure;
        }
        self.check_for_duplicate_fields();

        // lets avoid most allocations
        // SAFETY: ExternColumnIdentifier is #[repr(C)] POD; we only read indices we've written.
        let mut stack_ids: [MaybeUninit<JSObject::ExternColumnIdentifier>; 70] =
            unsafe { MaybeUninit::uninit().assume_init() };
        // lets de duplicate the fields early
        let mut non_duplicated_count = self.fields.len();
        for field in &self.fields {
            if matches!(field.name_or_index, protocol::NameOrIndex::Duplicate) {
                non_duplicated_count -= 1;
            }
        }

        let mut heap_ids: Vec<JSObject::ExternColumnIdentifier>;
        let ids: &mut [MaybeUninit<JSObject::ExternColumnIdentifier>] =
            if non_duplicated_count <= JSObject::max_inline_capacity() {
                &mut stack_ids[0..non_duplicated_count]
            } else {
                heap_ids = Vec::with_capacity(non_duplicated_count);
                // SAFETY: we treat the spare capacity as MaybeUninit and fully initialize
                // [0..non_duplicated_count] below before any read.
                unsafe { heap_ids.set_len(non_duplicated_count) };
                // TODO(port): expose this as a proper boxed slice once ExternColumnIdentifier
                // ownership is settled; Zig hands ownership to `cached_structure.set`.
                // SAFETY: heap_ids has capacity == non_duplicated_count and len was set above;
                // reinterpreting as [MaybeUninit<T>] is sound for any T.
                unsafe {
                    core::slice::from_raw_parts_mut(
                        heap_ids.as_mut_ptr().cast::<MaybeUninit<JSObject::ExternColumnIdentifier>>(),
                        non_duplicated_count,
                    )
                }
            };

        let mut i: usize = 0;
        for field in &self.fields {
            if matches!(field.name_or_index, protocol::NameOrIndex::Duplicate) {
                continue;
            }

            let id = &mut ids[i];
            let mut out = JSObject::ExternColumnIdentifier::default();
            match &field.name_or_index {
                protocol::NameOrIndex::Name(name) => {
                    out.value.name = String::create_atom_if_possible(name.slice());
                }
                protocol::NameOrIndex::Index(index) => {
                    out.value.index = *index;
                }
                protocol::NameOrIndex::Duplicate => unreachable!(),
            }
            out.tag = match field.name_or_index {
                protocol::NameOrIndex::Name(_) => 2,
                protocol::NameOrIndex::Index(_) => 1,
                protocol::NameOrIndex::Duplicate => 0,
            };
            id.write(out);
            i += 1;
        }

        // SAFETY: every element in ids[0..i] (== ids[..]) was written above.
        let ids: &mut [JSObject::ExternColumnIdentifier] = unsafe {
            core::slice::from_raw_parts_mut(ids.as_mut_ptr().cast(), ids.len())
        };

        if non_duplicated_count > JSObject::max_inline_capacity() {
            self.cached_structure.set(global_object, None, Some(ids));
        } else {
            self.cached_structure.set(
                global_object,
                Some(JSObject::create_structure(
                    global_object,
                    owner,
                    ids.len() as u32,
                    ids.as_mut_ptr(),
                )),
                None,
            );
        }

        self.cached_structure
    }
}

impl Drop for PostgresSQLStatement {
    fn drop(&mut self) {
        bun_output::scoped_log!(Postgres, "PostgresSQLStatement deinit");

        debug_assert_eq!(self.ref_count.get(), 0, "ref_count.assertNoRefs()");

        // `fields` (Vec<FieldDescription>): each element's Drop runs, then the buffer frees.
        // `parameters` (Box<[int4]>): freed by Drop.
        // `cached_structure`, `error_response`, `signature`: Drop.
        // `bun.default_allocator.destroy(this)`: handled by `bun_ptr::IntrusiveRc` dealloc,
        // not here — Drop must not free `self`'s storage.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/PostgresSQLStatement.zig (182 lines)
//   confidence: medium
//   todos:      3
//   notes:      IntrusiveRc owns dealloc; structure() heap-ids ownership handoff to cached_structure.set needs Phase B review
// ──────────────────────────────────────────────────────────────────────────
