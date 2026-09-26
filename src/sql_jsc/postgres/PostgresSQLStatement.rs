use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsCell, JsResult};

use crate::postgres::error_jsc::postgres_error_to_js;
use crate::postgres::signature::Signature;
use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::int4;

bun_core::declare_scope!(Postgres, visible);

// Intrusive single-thread refcount (`CellRefCounted`). Shared between the owning query and the connection's prepared-statement map
// (each holds a `RefPtr`), so every field written after construction is
// interior-mutable and the statement is only ever reached as `&Self`.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLStatement {
    pub(crate) cached_structure: JsCell<PostgresCachedStructure>,
    ref_count: Cell<u32>,
    pub(crate) fields: JsCell<Vec<protocol::FieldDescription>>,
    pub(crate) parameters: JsCell<Box<[int4]>>,
    pub(crate) signature: Signature,
    pub(crate) status: Cell<Status>,
    pub(crate) error_response: JsCell<Option<Error>>,
    pub(crate) needs_duplicate_check: Cell<bool>,
    pub(crate) fields_flags: Cell<DataCellFlags>,
}

pub enum Error {
    Protocol(protocol::ErrorResponse),
    PostgresError(AnyPostgresError),
}

impl Error {
    // Cleanup is handled by `Drop` on
    // `protocol::ErrorResponse`, so no explicit `Drop` impl is needed here.

    pub(crate) fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
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
    /// A new statement with one ref, owned by the returned handle.
    pub(crate) fn new(signature: Signature, status: Status) -> bun_ptr::RefPtr<Self> {
        bun_ptr::RefPtr::new(Self {
            cached_structure: JsCell::new(PostgresCachedStructure::default()),
            ref_count: Cell::new(1),
            fields: JsCell::new(Vec::new()),
            parameters: JsCell::new(Box::default()),
            signature,
            status: Cell::new(status),
            error_response: JsCell::new(None),
            needs_duplicate_check: Cell::new(true),
            fields_flags: Cell::new(DataCellFlags::default()),
        })
    }

    /// The stored error as a JS value (`undefined` if none is stored).
    pub(crate) fn error_response_to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self.error_response.get() {
            Some(e) => e.to_js(global_object),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    /// Record `err` and mark the statement failed.
    pub(crate) fn fail(&self, err: Error) {
        self.status.set(Status::Failed);
        self.error_response.set(Some(err));
    }

    pub(crate) fn check_for_duplicate_fields(&self) {
        if !self.needs_duplicate_check.get() {
            return;
        }
        self.needs_duplicate_check.set(false);

        let flags = self.fields.with_mut(|fields| {
            dedupe_columns(fields.iter_mut().rev().map(|f| &mut f.name_or_index))
        });
        self.fields_flags.set(flags);
    }

    /// The cached JSC structure for this statement's columns, building it on
    /// first use.
    pub(crate) fn structure(
        &self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> &PostgresCachedStructure {
        if !self.cached_structure.get().has() {
            self.check_for_duplicate_fields();
            let fields = self.fields.get();
            self.cached_structure.with_mut(|cs| {
                cs.build_from_columns(
                    global_object,
                    owner,
                    fields.iter().map(|f| &f.name_or_index),
                )
            });
        }
        self.cached_structure.get()
    }
}

impl Drop for PostgresSQLStatement {
    fn drop(&mut self) {
        bun_core::scoped_log!(Postgres, "PostgresSQLStatement deinit");

        debug_assert_eq!(self.ref_count.get(), 0, "ref_count.assertNoRefs()");

        // `fields` (Vec<FieldDescription>): each element's Drop runs, then the buffer frees.
        // `parameters` (Box<[int4]>): freed by Drop.
        // `cached_structure`, `error_response`, `signature`: Drop.
    }
}
