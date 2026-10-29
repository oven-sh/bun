use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsResult, Strong};

use crate::postgres::signature::Signature;
use crate::shared::cached_structure::{
    CachedStructure as PostgresCachedStructure, column_name_to_js, describe_statement,
};
use crate::shared::row_decoder::{RowColumn, RowDecoder, WireFormat};
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_ptr::RefPtr;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::{self as types, int4};
use bun_sql::shared::ColumnIdentifier;

bun_core::declare_scope!(Postgres, visible);

#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLStatement {
    pub(crate) cached_structure: PostgresCachedStructure,
    ref_count: Cell<u32>,
    pub(crate) fields: Vec<protocol::FieldDescription>,
    pub(crate) parameters: Box<[int4]>,
    pub(crate) signature: Signature,
    pub(crate) status: Status,
    pub(crate) error_response: Option<Error>,
    pub(crate) needs_duplicate_check: bool,
    pub(crate) fields_flags: DataCellFlags,
    pub(crate) row_decoder: RowDecoder,
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
            row_decoder: RowDecoder::default(),
        }
    }
}

pub enum Error {
    Protocol(protocol::ErrorResponse),
    /// What the client's column transform threw at the RowDescription.
    Thrown(Strong),
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
            Error::Thrown(err) => Ok(err.get()),
        }
    }
}

pub use bun_sql::shared::statement_status::Status;

impl PostgresSQLStatement {
    pub(crate) fn new(signature: Signature) -> RefPtr<PostgresSQLStatement> {
        // It implements Drop, so `..Default::default()` is not allowed (E0509).
        let mut statement = PostgresSQLStatement::default();
        statement.signature = signature;
        RefPtr::new(statement)
    }

    /// Each type is the one Parse declared, or the one the server chose where Parse declared none.
    fn accepts(&self, declared: &[Option<int4>]) -> bool {
        let fields = &self.signature.fields;
        declared.len() == fields.len()
            && declared
                .iter()
                .enumerate()
                .all(|(i, declared)| match *declared {
                    None => true,
                    Some(oid) => {
                        oid == fields[i] || (fields[i] == 0 && self.parameters.get(i) == Some(&oid))
                    }
                })
    }

    /// The server's types once it has described the statement, until then the declared ones.
    pub(crate) fn parameter_types(&self) -> &[int4] {
        if self.parameters.is_empty() {
            &self.signature.fields
        } else {
            &self.parameters
        }
    }

    pub(crate) fn check_for_duplicate_fields(&mut self) {
        if !self.needs_duplicate_check {
            return;
        }
        self.needs_duplicate_check = false;

        self.fields_flags =
            dedupe_columns(self.fields.iter_mut().rev().map(|f| &mut f.name_or_index));
    }

    pub(crate) fn create_row_decoder(&mut self, global_object: &JSGlobalObject, row_type: u32) {
        use types::Tag as T;
        self.check_for_duplicate_fields();
        let columns: Option<Vec<RowColumn>> = self
            .fields
            .iter()
            .map(|field| {
                let ColumnIdentifier::Name(name) = &field.name_or_index else {
                    return None;
                };
                let tag = field.type_tag();
                let is_binary = field.binary || tag.is_binary_in(types::ResultFormats::Decodable);
                let format = match (tag, is_binary) {
                    (T::int4, true) => WireFormat::Int32,
                    (T::float4, true) => WireFormat::Float32,
                    (T::float8, true) => WireFormat::Float64,
                    (T::bool, true) => WireFormat::Boolean,
                    (T::timestamp | T::timestamptz, true) => WireFormat::TimestampMicroseconds,
                    (T::text | T::varchar | T::bpchar | T::name, _)
                    | (T::uuid | T::int8, false) => WireFormat::Text,
                    _ => return None,
                };
                Some(RowColumn {
                    name: name.slice().as_ptr(),
                    name_length: name.slice().len() as u32,
                    format,
                })
            })
            .collect();
        self.row_decoder = RowDecoder::new(global_object, row_type, columns.as_deref());
    }

    // Note: returning
    // `&CachedStructure` here to avoid moving out of `self` (CachedStructure owns
    // a `Box<[ExternColumnIdentifier]>` and a `StrongOptional`, neither `Copy`).
    pub(crate) fn structure(
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

    /// Other queries run it too.
    pub(crate) fn is_named(&self) -> bool {
        !self.signature.prepared_statement_name.is_empty()
    }

    /// `result.statement` of the results of a named statement.
    pub(crate) fn description(
        &mut self,
        global_object: &JSGlobalObject,
        query: &bun_core::String,
    ) -> JsResult<JSValue> {
        if let Some(description) = self.cached_structure.description() {
            return Ok(description);
        }
        let description = describe(global_object, query, &self.parameters, &self.fields)?;
        self.cached_structure
            .set_description(global_object, description);
        Ok(description)
    }

    /// What `describe` takes, of the result that just ended. The next one starts with no fields:
    /// in a simple query a command that returns no rows comes without a RowDescription.
    pub(crate) fn take_result(&mut self) -> ResultDescription {
        self.cached_structure = Default::default();
        self.needs_duplicate_check = true;
        self.fields_flags = Default::default();
        self.row_decoder = Default::default();
        (
            core::mem::take(&mut self.parameters),
            core::mem::take(&mut self.fields),
        )
    }
}

pub(crate) type ResultDescription = (Box<[int4]>, Vec<protocol::FieldDescription>);

/// `result.statement` in JS.
pub(crate) fn describe(
    global_object: &JSGlobalObject,
    query: &bun_core::String,
    parameters: &[int4],
    fields: &[protocol::FieldDescription],
) -> JsResult<JSValue> {
    describe_statement(
        global_object,
        query,
        parameters,
        [c"name", c"type", c"table", c"number"],
        |values| {
            for field in fields {
                values.append(column_name_to_js(global_object, &field.name_or_index)?);
                values.append(JSValue::js_number_from_uint64(field.type_oid.into()));
                values.append(JSValue::js_number_from_uint64(field.table_oid.into()));
                values.append(JSValue::js_number_from_int32(field.attribute_number.into()));
            }
            Ok(())
        },
    )
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

#[derive(Default)]
pub(crate) struct StatementCache {
    cache: crate::shared::StatementCache<PostgresSQLStatement>,
    /// Out of `cache` for good, and the server still has them.
    discarded: Vec<RefPtr<PostgresSQLStatement>>,
}

impl StatementCache {
    /// A statement with a join and ten columns takes about 40 KB of the backend's memory.
    const MAX_STATEMENTS: usize = 1024;

    pub(crate) fn get(
        &mut self,
        query: &[u8],
        declared: &[Option<int4>],
    ) -> Option<RefPtr<PostgresSQLStatement>> {
        self.cache
            .find(query, |statement| statement.accepts(declared))
    }

    pub(crate) fn insert(&mut self, query: &[u8], statement: RefPtr<PostgresSQLStatement>) {
        self.cache.add(query, statement);
    }

    pub(crate) fn remove(&mut self, statement: &PostgresSQLStatement) {
        self.cache.remove(statement);
    }

    /// `remove` for a statement that the server has: `evict` hands it over to be closed there.
    pub(crate) fn discard(&mut self, statement: &PostgresSQLStatement) {
        self.discarded.extend(self.cache.remove(statement));
    }

    /// A statement that the request that found `stale` parses itself.
    pub(crate) fn replace(
        &mut self,
        query: &[u8],
        stale: &PostgresSQLStatement,
        id: impl FnOnce() -> u64,
    ) -> RefPtr<PostgresSQLStatement> {
        self.discard(stale);
        // One that only `accepts` can be as stale.
        if let Some(variant) = self.cache.find(query, |variant| {
            variant.signature.fields == stale.signature.fields
        }) {
            if variant.status == Status::Pending {
                return variant;
            }
            // Prepared for an earlier request that found `stale`, and perhaps lost since.
            self.discard(&variant);
        }
        let replacement = PostgresSQLStatement::new(stale.signature.renamed(id()));
        self.cache.add(query, replacement.clone());
        replacement
    }

    /// Never one that a request holds.
    pub(crate) fn evict(&mut self) -> Option<RefPtr<PostgresSQLStatement>> {
        if let Some(i) = self
            .discarded
            .iter()
            .position(|statement| statement.ref_count.get() == 1)
        {
            return Some(self.discarded.swap_remove(i));
        }
        self.cache.evict(Self::MAX_STATEMENTS)
    }
}
