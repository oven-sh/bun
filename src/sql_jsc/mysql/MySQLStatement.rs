use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsCell, JsResult, bun_string_jsc};

use crate::shared::CachedStructure;
use crate::shared::cached_structure::{column_name_to_js, describe_statement};
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_ptr::RefPtr;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::prepared_statement::ExecuteParam;
use bun_sql::mysql::session::Statement;

bun_core::declare_scope!(MySQLStatement, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub struct MySQLStatement {
    ref_count: Cell<u32>,
    pub(crate) wire: JsCell<Statement>,
    /// Made from `wire.columns` at the first row, like `fields_flags`.
    cached_structure: JsCell<CachedStructure>,
    pub(crate) fields_flags: Cell<DataCellFlags>,
    /// What its executions declare for each parameter. `None`: only NULL so far.
    parameter_types: Box<[Cell<Option<ParameterType>>]>,
}

/// Type and signedness, as COM_STMT_EXECUTE declares them.
type ParameterType = (FieldType, bool);

fn parameter_type(param: &impl ExecuteParam) -> Option<ParameterType> {
    let field_type = param.field_type();
    (field_type != FieldType::MYSQL_TYPE_NULL).then(|| (field_type, param.is_unsigned()))
}

impl MySQLStatement {
    /// The statement of a simple query: it only holds the columns of the result.
    pub(crate) fn unprepared() -> Self {
        Self::new(Box::default())
    }

    fn new(parameter_types: Box<[Cell<Option<ParameterType>>]>) -> Self {
        Self {
            ref_count: Cell::new(1),
            wire: JsCell::default(),
            cached_structure: JsCell::default(),
            fields_flags: Cell::default(),
            parameter_types,
        }
    }

    /// MySQL 8 settles the type of a parameter at its first non-NULL value and converts every
    /// later value to it, so a statement runs with one type for each parameter.
    fn accepts<P: ExecuteParam>(&self, params: &[P]) -> bool {
        params.len() == self.parameter_types.len()
            && params
                .iter()
                .zip(self.parameter_types.iter())
                .all(|(param, settled)| {
                    parameter_type(param)
                        .zip(settled.get())
                        .is_none_or(|(declared, settled)| declared == settled)
                })
    }

    fn settle<P: ExecuteParam>(&self, params: &[P]) {
        for (param, settled) in params.iter().zip(self.parameter_types.iter()) {
            if settled.get().is_none() {
                settled.set(parameter_type(param));
            }
        }
    }

    pub(crate) fn parameter_count_matches(&self) -> bool {
        self.wire.get().params.len() == self.parameter_types.len()
    }

    pub(crate) fn with_column(&self, index: usize, change: impl FnOnce(&mut ColumnDefinition41)) {
        self.wire
            .with_mut(|wire| wire.columns.get_mut(index).map(change));
    }

    pub(crate) fn clear_structure(&self) {
        self.cached_structure.set(Default::default());
        self.fields_flags.set(Default::default());
    }

    pub(crate) fn clear_description(&self) {
        self.cached_structure.with_mut(|c| c.clear_description());
    }

    pub(crate) fn structure(
        &self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> &CachedStructure {
        if !self.cached_structure.get().has() {
            self.fields_flags.set(self.wire.with_mut(|wire| {
                dedupe_columns(wire.columns.iter_mut().rev().map(|c| &mut c.name_or_index))
            }));
            let names = self.wire.get().columns.iter().map(|c| &c.name_or_index);
            self.cached_structure
                .with_mut(|cached| cached.build_from_columns(global_object, owner, names));
        }
        self.cached_structure.get()
    }

    /// `result.statement`. Without `has_columns`, the columns are an earlier result set's.
    pub(crate) fn description(
        &self,
        global_object: &JSGlobalObject,
        query: &bun_core::String,
        has_columns: bool,
    ) -> JsResult<JSValue> {
        let wire = self.wire.get();
        if !has_columns && !wire.columns.is_empty() {
            return describe(global_object, query, &wire.params, &[]);
        }
        if let Some(description) = self.cached_structure.get().description() {
            return Ok(description);
        }
        let description = describe(global_object, query, &wire.params, &wire.columns)?;
        self.cached_structure
            .with_mut(|cached| cached.set_description(global_object, description));
        Ok(description)
    }

    /// The columns of the result that just ended, for `describe`.
    pub(crate) fn take_columns(&self, has_columns: bool) -> Vec<ColumnDefinition41> {
        if has_columns {
            self.wire
                .with_mut(|wire| core::mem::take(&mut wire.columns))
        } else {
            Vec::new()
        }
    }
}

/// `result.statement` in JS.
pub(crate) fn describe(
    global_object: &JSGlobalObject,
    query: &bun_core::String,
    params: &[FieldType],
    columns: &[ColumnDefinition41],
) -> JsResult<JSValue> {
    let parameter_types: Vec<u32> = params.iter().map(|&param| param as u32).collect();
    describe_statement(
        global_object,
        query,
        &parameter_types,
        [c"name", c"type", c"table", c"length", c"flags"],
        |values| {
            for column in columns {
                values.append(column_name_to_js(global_object, &column.name_or_index)?);
                values.append(JSValue::js_number_from_int32(column.column_type as i32));
                values.append(bun_string_jsc::create_utf8_for_js(
                    global_object,
                    &column.table,
                )?);
                values.append(JSValue::js_number_from_uint64(column.column_length.into()));
                values.append(JSValue::js_number_from_int32(column.flags.bits().into()));
            }
            Ok(())
        },
    )
}

impl Drop for MySQLStatement {
    fn drop(&mut self) {
        bun_core::scoped_log!(MySQLStatement, "MySQLStatement deinit");
    }
}

pub(crate) type StatementCache = crate::shared::StatementCache<MySQLStatement>;

impl StatementCache {
    /// As the mariadb connector's `prepareCacheLength`. All connections to a server share its
    /// `max_prepared_stmt_count`, 16,382 by default.
    pub(crate) const MAX_STATEMENTS: usize = 256;

    pub(crate) fn get<P: ExecuteParam>(
        &mut self,
        query: &[u8],
        params: &[P],
    ) -> Option<RefPtr<MySQLStatement>> {
        let statement = self.find(query, |statement| statement.accepts(params))?;
        statement.settle(params);
        Some(statement)
    }

    pub(crate) fn insert<P: ExecuteParam>(
        &mut self,
        query: &[u8],
        params: &[P],
    ) -> RefPtr<MySQLStatement> {
        let statement = RefPtr::new(MySQLStatement::new(
            params
                .iter()
                .map(|param| Cell::new(parameter_type(param)))
                .collect(),
        ));
        self.add(query, statement.clone());
        statement
    }
}
