use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsResult};

use crate::postgres::error_jsc::postgres_error_to_js;
use crate::postgres::signature::Signature;
use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::int4;

bun_core::declare_scope!(Postgres, visible);

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread refcount.
// Ported as an embedded `Cell<u32>` driven by `bun_ptr::IntrusiveRc<PostgresSQLStatement>`;
// `ref`/`deref` are provided by `IntrusiveRc`, not as inherent methods.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLStatement {
    pub cached_structure: PostgresCachedStructure,
    // Private — intrusive refcount invariant; reach via `ref_()`/`deref()` or
    // [`Self::init_exact_refs`] at construction time.
    ref_count: Cell<u32>,
    pub fields: Vec<protocol::FieldDescription>,
    pub parameters: Box<[int4]>,
    pub signature: Signature,
    pub status: Status,
    pub error_response: Option<Error>,
    pub needs_duplicate_check: bool,
    pub fields_flags: DataCellFlags,
}

impl Default for PostgresSQLStatement {
    fn default() -> Self {
        // Callers must set `signature`. This Default
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
            fields_flags: DataCellFlags::default(),
        }
    }
}

pub enum Error {
    Protocol(protocol::ErrorResponse),
    PostgresError(AnyPostgresError),
}

impl Error {
    // Cleanup is handled by `Drop` on
    // `protocol::ErrorResponse`, so no explicit `Drop` impl is needed here.

    pub fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Error::Protocol(err) => Ok(crate::postgres::protocol::error_response_jsc::to_js(
                err,
                global_object,
            )),
            Error::PostgresError(err) => Ok(postgres_error_to_js(global_object, None, *err)),
        }
    }
}

pub use bun_sql::shared::statement_status::Status;

impl PostgresSQLStatement {
    /// Set the initial intrusive
    /// refcount at construction time, before any `ref_()`/`deref()`. The
    /// `ref_count` field is private (refcount invariant), so callers building
    /// a statement with >1 owner (query + connection-map entry) go through
    /// this instead of writing the field directly.
    #[inline]
    pub fn init_exact_refs(&mut self, n: u32) {
        debug_assert!(n > 0);
        self.ref_count.set(n);
    }

    pub fn check_for_duplicate_fields(&mut self) {
        if !self.needs_duplicate_check {
            return;
        }
        self.needs_duplicate_check = false;

        self.fields_flags =
            dedupe_columns(self.fields.iter_mut().rev().map(|f| &mut f.name_or_index));
    }

    // Note: returning
    // `&CachedStructure` here to avoid moving out of `self` (CachedStructure owns
    // a `Box<[ExternColumnIdentifier]>` and a `StrongOptional`, neither `Copy`).
    pub fn structure(
        &mut self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> &PostgresCachedStructure {
        if self.cached_structure.has() {
            return &self.cached_structure;
        }
        self.check_for_duplicate_fields();
        self.cached_structure.build_from_columns(
            global_object,
            owner,
            self.fields.iter().map(|f| &f.name_or_index),
        );
        &self.cached_structure
    }
}

impl Drop for PostgresSQLStatement {
    fn drop(&mut self) {
        bun_core::scoped_log!(Postgres, "PostgresSQLStatement deinit");

        debug_assert_eq!(self.ref_count.get(), 0, "ref_count.assertNoRefs()");

        // `fields` (Vec<FieldDescription>): each element's Drop runs, then the buffer frees.
        // `parameters` (Box<[int4]>): freed by Drop.
        // `cached_structure`, `error_response`, `signature`: Drop.
        // `bun.default_allocator.destroy(this)`: handled by `bun_ptr::IntrusiveRc` dealloc,
        // not here — Drop must not free `self`'s storage.
    }
}
