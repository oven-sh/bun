use crate::jsc::{JSGlobalObject, JSValue, JsResult, Strong};

use crate::shared::cached_structure::{CachedStructure, column_name_to_js, describe_statement};
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_jsc::JsCell;
use bun_ptr::{CellRefCounted as _, RefPtr};
use bun_sql::postgres::pipeline::Statement;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::int4;

pub type PostgresSQLStatement = Statement<Error, JsCell<Columns>>;

pub enum Error {
    Protocol(protocol::ErrorResponse),
    /// What the client's column transform threw at the RowDescription.
    Thrown(Strong),
}

impl Error {
    pub(crate) fn to_js(&self, global_object: &JSGlobalObject) -> JSValue {
        match self {
            Error::Protocol(err) => super::protocol::error_response_jsc::to_js(err, global_object),
            Error::Thrown(err) => err.get(),
        }
    }
}

/// A RowDescription, and what is made of it when it is first needed.
#[derive(Default)]
pub struct Columns {
    pub(crate) fields: Vec<protocol::FieldDescription>,
    pub(crate) structure: CachedStructure,
    pub(crate) flags: DataCellFlags,
}

impl Columns {
    pub(crate) fn build_structure(&mut self, owner: JSValue, global_object: &JSGlobalObject) {
        if self.structure.has() {
            return;
        }
        self.flags = dedupe_columns(self.fields.iter_mut().rev().map(|f| &mut f.name_or_index));
        let names = self.fields.iter().map(|f| &f.name_or_index);
        self.structure
            .build_from_columns(global_object, owner, names);
    }

    /// `result.statement` of the results of a named statement.
    pub(crate) fn description(
        &mut self,
        global_object: &JSGlobalObject,
        query: &bun_core::String,
        parameters: &[int4],
    ) -> JsResult<JSValue> {
        if let Some(description) = self.structure.description() {
            return Ok(description);
        }
        let description = describe(global_object, query, parameters, &self.fields)?;
        self.structure.set_description(global_object, description);
        Ok(description)
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

#[derive(Default)]
pub(crate) struct StatementCache {
    cache: crate::shared::StatementCache<PostgresSQLStatement>,
    /// Out of `cache` for good, and the server still has them.
    discarded: Vec<RefPtr<PostgresSQLStatement>>,
    next_id: u64,
}

impl StatementCache {
    /// A statement with a join and ten columns takes about 40 KB of the backend's memory.
    const MAX_STATEMENTS: usize = 1024;

    /// `None` in `types` is NULL, which fits every type.
    pub(crate) fn get_or_add(
        &mut self,
        query: &[u8],
        types: &[Option<int4>],
    ) -> RefPtr<PostgresSQLStatement> {
        self.cache
            .find(query, |statement| statement.accepts(types))
            .unwrap_or_else(|| self.add(query, declared(types)))
    }

    fn add(&mut self, query: &[u8], declared: Box<[int4]>) -> RefPtr<PostgresSQLStatement> {
        let statement = Statement::new(Some(self.next_id), declared, JsCell::default());
        self.next_id += 1;
        self.cache.add(query, statement.clone());
        statement
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
    ) -> RefPtr<PostgresSQLStatement> {
        self.discard(stale);
        // One that only `accepts` can be as stale.
        if let Some(variant) = self
            .cache
            .find(query, |variant| variant.declared == stale.declared)
        {
            if variant.is_unparsed() {
                return variant;
            }
            // Prepared for an earlier request that found `stale`, and perhaps lost since.
            self.discard(&variant);
        }
        self.add(query, stale.declared.clone())
    }

    /// Never one that a request holds.
    pub(crate) fn evict(&mut self) -> Option<RefPtr<PostgresSQLStatement>> {
        if let Some(i) = self
            .discarded
            .iter()
            .position(|statement| statement.ref_count().get() == 1)
        {
            return Some(self.discarded.swap_remove(i));
        }
        self.cache.evict(Self::MAX_STATEMENTS)
    }
}

pub(crate) fn declared(types: &[Option<int4>]) -> Box<[int4]> {
    types.iter().map(|oid| oid.unwrap_or(0)).collect()
}
