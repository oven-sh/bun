use core::cell::{Cell, OnceCell};
use std::rc::Rc;

use crate::jsc::{JSGlobalObject, JSValue, JsResult, Strong};

use crate::postgres::signature::Signature;
use crate::shared::cached_structure::{
    CachedStructure as PostgresCachedStructure, column_name_to_js, describe_statement,
};
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_jsc::Weak;
use bun_ptr::{CellExt as _, VecCellExt as _};
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::int4;

bun_core::declare_scope!(Postgres, visible);

pub struct PostgresSQLStatement {
    columns: OnceCell<Columns>,
    parameters: OnceCell<Box<[int4]>>,
    /// `result.statement`, kept alive only by the results that hold it.
    description: Cell<Weak<()>>,
    pub(crate) signature: Signature,
    pub(crate) status: Cell<Status>,
    pub(crate) error_response: OnceCell<Error>,
}

impl Default for PostgresSQLStatement {
    fn default() -> Self {
        // Callers must set `signature`. This Default
        // exists only to mirror the per-field `= ...` initializers.
        Self {
            columns: OnceCell::new(),
            parameters: OnceCell::new(),
            description: Cell::default(),
            signature: Signature::default(),
            status: Cell::new(Status::Pending),
            error_response: OnceCell::new(),
        }
    }
}

/// The fields of a RowDescription, and what is derived from them.
#[derive(Default)]
pub(crate) struct Columns {
    pub(crate) fields: Box<[protocol::FieldDescription]>,
    pub(crate) cached_structure: OnceCell<PostgresCachedStructure>,
    needs_duplicate_check: bool,
    pub(crate) fields_flags: DataCellFlags,
}

impl Columns {
    fn check_for_duplicate_fields(&mut self) {
        if !core::mem::take(&mut self.needs_duplicate_check) {
            return;
        }

        self.fields_flags =
            dedupe_columns(self.fields.iter_mut().rev().map(|f| &mut f.name_or_index));
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
    pub(crate) fn new(signature: Signature) -> Rc<PostgresSQLStatement> {
        // It implements Drop, so `..Default::default()` is not allowed (E0509).
        let mut statement = PostgresSQLStatement::default();
        statement.signature = signature;
        Rc::new(statement)
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
                        oid == fields[i]
                            || (fields[i] == 0 && self.parameter_types().get(i) == Some(&oid))
                    }
                })
    }

    /// The server's types once it has described the statement, until then the declared ones.
    pub(crate) fn parameter_types(&self) -> &[int4] {
        match self.parameters.get() {
            Some(parameters) if !parameters.is_empty() => parameters,
            _ => &self.signature.fields,
        }
    }

    pub(crate) fn fields(&self) -> &[protocol::FieldDescription] {
        self.columns.get().map_or(&[], |columns| &columns.fields)
    }

    /// For a row. Without a RowDescription so far, the statement has no columns.
    pub(crate) fn columns(&self) -> &Columns {
        self.columns.get_or_init(Columns::default)
    }

    /// `false`: others hold the statement and can have borrowed its types, so it keeps them.
    pub(crate) fn set_parameters(this: &mut Rc<Self>, parameters: Box<[int4]>) -> bool {
        if let Some(statement) = Rc::get_mut(this) {
            statement.parameters.take();
        }
        this.parameters.set(parameters).is_ok()
    }

    /// As `set_parameters`.
    pub(crate) fn set_fields(
        this: &mut Rc<Self>,
        fields: Box<[protocol::FieldDescription]>,
    ) -> bool {
        let mut columns = Columns {
            fields,
            needs_duplicate_check: true,
            ..Default::default()
        };
        if let Some(statement) = Rc::get_mut(this) {
            statement.columns = OnceCell::from(columns);
            return true;
        }
        columns.check_for_duplicate_fields();
        this.columns.set(columns).is_ok()
    }

    pub(crate) fn build_structure(
        this: &mut Rc<Self>,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) {
        if let Some(columns) = Rc::get_mut(this).and_then(|this| this.columns.get_mut()) {
            columns.check_for_duplicate_fields();
        }
        let columns = this.columns();
        if columns.needs_duplicate_check {
            return;
        }
        columns.cached_structure.get_or_init(|| {
            let mut cached_structure = PostgresCachedStructure::default();
            cached_structure.build_from_columns(
                global_object,
                owner,
                columns.fields.iter().map(|f| &f.name_or_index),
            );
            cached_structure
        });
    }

    /// Other queries run it too.
    pub(crate) fn is_named(&self) -> bool {
        !self.signature.prepared_statement_name.is_empty()
    }

    /// `result.statement` of the results of a named statement.
    pub(crate) fn description(
        &self,
        global_object: &JSGlobalObject,
        query: &bun_core::String,
    ) -> JsResult<JSValue> {
        let weak = self.description.take();
        let cached = weak.get();
        self.description.put_back(weak);
        if let Some(description) = cached {
            return Ok(description);
        }
        let parameters = self.parameters.get().map_or(&[][..], |types| types);
        let description = describe(global_object, query, parameters, self.fields())?;
        self.description
            .set(Weak::create_passive(description, global_object));
        Ok(description)
    }

    /// What `describe` takes, of the result that just ended. The next one starts with no fields:
    /// in a simple query a command that returns no rows comes without a RowDescription.
    pub(crate) fn take_result(&mut self) -> ResultDescription {
        (
            self.parameters.take().unwrap_or_default(),
            self.columns.take().unwrap_or_default().fields,
        )
    }
}

pub(crate) type ResultDescription = (Box<[int4]>, Box<[protocol::FieldDescription]>);

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
    }
}

#[derive(Default)]
pub(crate) struct StatementCache {
    cache: crate::shared::StatementCache<PostgresSQLStatement>,
    /// Out of `cache` for good, and the server still has them.
    discarded: Cell<Vec<Rc<PostgresSQLStatement>>>,
}

impl StatementCache {
    /// A statement with a join and ten columns takes about 40 KB of the backend's memory.
    const MAX_STATEMENTS: usize = 1024;

    pub(crate) fn get(
        &self,
        query: &[u8],
        declared: &[Option<int4>],
    ) -> Option<Rc<PostgresSQLStatement>> {
        self.cache
            .find(query, |statement| statement.accepts(declared))
    }

    pub(crate) fn insert(&self, query: &[u8], statement: Rc<PostgresSQLStatement>) {
        self.cache.add(query, statement);
    }

    pub(crate) fn remove(&self, statement: &PostgresSQLStatement) {
        self.cache.remove(statement);
    }

    /// `remove` for a statement that the server has: `evict` hands it over to be closed there.
    pub(crate) fn discard(&self, statement: &PostgresSQLStatement) {
        if let Some(statement) = self.cache.remove(statement) {
            self.discarded.push(statement);
        }
    }

    /// A statement that the request that found `stale` parses itself.
    pub(crate) fn replace(
        &self,
        query: &[u8],
        stale: &PostgresSQLStatement,
        id: impl FnOnce() -> u64,
    ) -> Rc<PostgresSQLStatement> {
        self.discard(stale);
        // One that only `accepts` can be as stale.
        if let Some(variant) = self.cache.find(query, |variant| {
            variant.signature.fields == stale.signature.fields
        }) {
            if variant.status.get() == Status::Pending {
                return variant;
            }
            // Prepared for an earlier request that found `stale`, and perhaps lost since.
            self.discard(&variant);
        }
        let replacement = PostgresSQLStatement::new(stale.signature.renamed(id()));
        self.cache.add(query, Rc::clone(&replacement));
        replacement
    }

    /// Never one that a request holds.
    pub(crate) fn evict(&self) -> Option<Rc<PostgresSQLStatement>> {
        self.discarded
            .with_taken(|discarded| {
                let i = discarded
                    .iter()
                    .position(|statement| Rc::strong_count(statement) == 1)?;
                Some(discarded.swap_remove(i))
            })
            .or_else(|| self.cache.evict(Self::MAX_STATEMENTS))
    }
}
