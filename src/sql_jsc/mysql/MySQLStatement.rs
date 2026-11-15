use core::cell::Cell;
use core::ops::Deref;
use std::rc::Rc;

use crate::jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};

use crate::shared::CachedStructure;
use crate::shared::cached_structure::{column_name_to_js, describe_statement};
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_jsc::Weak;
use bun_ptr::{CellExt as _, VecCellExt as _};
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::prepared_statement::ExecuteParam;

bun_core::declare_scope!(MySQLStatement, hidden);

pub struct MySQLStatement {
    pub(crate) statement_id: Cell<u32>,
    pub(crate) params: Cell<Vec<FieldType>>,
    pub(crate) status: Cell<Status>,
    result: Cell<Option<ResultState>>,
    /// Of `result`, as the last `ResultStateGuard` left it.
    has_columns: Cell<bool>,
    /// `result.statement`, kept alive only by the results that hold it.
    description: Cell<Weak<()>>,
    /// What its executions declare for each parameter. `None`: only NULL so far.
    parameter_types: Box<[Cell<Option<ParameterType>>]>,
}

/// What the packets of a result set, or of the reply to COM_STMT_PREPARE, change.
#[derive(Default)]
pub(crate) struct ResultState {
    pub(crate) cached_structure: CachedStructure,
    pub(crate) params_received: u32,
    pub(crate) columns: Vec<ColumnDefinition41>,
    pub(crate) columns_received: u32,
    pub(crate) execution_flags: ExecutionFlags,
    pub(crate) fields_flags: DataCellFlags,
    pub(crate) result_count: u64,
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
        Self::new(Status::Prepared, Box::default())
    }

    fn new(status: Status, parameter_types: Box<[Cell<Option<ParameterType>>]>) -> Self {
        Self {
            statement_id: Cell::new(0),
            params: Cell::default(),
            status: Cell::new(status),
            result: Cell::new(None),
            has_columns: Cell::new(false),
            description: Cell::default(),
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
        self.params.len() == self.parameter_types.len()
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct ExecutionFlags: u8 {
        const HEADER_RECEIVED      = 1 << 0;
        const NEEDS_DUPLICATE_CHECK = 1 << 1;
        /// In legacy protocol (CLIENT_DEPRECATE_EOF not negotiated), tracks whether
        /// the intermediate EOF packet between column definitions and row data has
        /// been consumed. This prevents the intermediate EOF from being mistakenly
        /// treated as end-of-result-set.
        const COLUMNS_EOF_RECEIVED = 1 << 2;
    }
}

impl Default for ExecutionFlags {
    fn default() -> Self {
        ExecutionFlags::NEEDS_DUPLICATE_CHECK
    }
}

pub use bun_sql::shared::statement_status::Status;

impl ResultState {
    pub(crate) fn reset(&mut self) {
        self.result_count = 0;
        self.columns_received = 0;
        self.execution_flags = ExecutionFlags::default();
    }

    fn check_for_duplicate_fields(&mut self) {
        if !self
            .execution_flags
            .contains(ExecutionFlags::NEEDS_DUPLICATE_CHECK)
        {
            return;
        }
        self.execution_flags
            .remove(ExecutionFlags::NEEDS_DUPLICATE_CHECK);

        self.fields_flags =
            dedupe_columns(self.columns.iter_mut().rev().map(|c| &mut c.name_or_index));
    }

    pub(crate) fn build_structure(&mut self, owner: JSValue, global_object: &JSGlobalObject) {
        if self.cached_structure.has() {
            return;
        }
        self.check_for_duplicate_fields();
        self.cached_structure.build_from_columns(
            global_object,
            owner,
            self.columns.iter().map(|c| &c.name_or_index),
        );
    }
}

/// The `result` of a statement, which gets it back on drop.
pub(crate) struct ResultStateGuard {
    statement: Rc<MySQLStatement>,
    result: Option<ResultState>,
}

impl Deref for ResultStateGuard {
    type Target = MySQLStatement;

    fn deref(&self) -> &MySQLStatement {
        &self.statement
    }
}

impl Drop for ResultStateGuard {
    fn drop(&mut self) {
        let has_columns = matches!(&self.result, Some(result) if !result.columns.is_empty());
        self.statement.has_columns.set(has_columns);
        self.statement.result.put_back(self.result.take());
    }
}

impl ResultStateGuard {
    pub(crate) fn new(statement: Rc<MySQLStatement>) -> Self {
        Self {
            result: statement.result.take(),
            statement,
        }
    }

    pub(crate) fn split(&mut self) -> (&MySQLStatement, &mut ResultState) {
        (&self.statement, self.result.get_or_insert_default())
    }
}

impl MySQLStatement {
    /// `result.statement` of a result set of a prepared statement.
    pub(crate) fn description(
        &self,
        global_object: &JSGlobalObject,
        query: &bun_core::String,
        columns: &[ColumnDefinition41],
    ) -> JsResult<JSValue> {
        let weak = self.description.take();
        let cached = weak.get();
        self.description.put_back(weak);
        if let Some(description) = cached {
            return Ok(description);
        }
        let description = self
            .params
            .with_taken(|params| describe(global_object, query, params, columns))?;
        self.description
            .set(Weak::create_passive(description, global_object));
        Ok(description)
    }

    /// As `description`, for an OK packet without a result set.
    pub(crate) fn description_without_columns(
        &self,
        global_object: &JSGlobalObject,
        query: &bun_core::String,
    ) -> JsResult<JSValue> {
        // The cached description is of an earlier result set.
        if self.has_columns.get() {
            return self
                .params
                .with_taken(|params| describe(global_object, query, params, &[]));
        }
        self.description(global_object, query, &[])
    }

    pub(crate) fn clear_description(&self) {
        self.description.set(Weak::default());
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
        &self,
        query: &[u8],
        params: &[P],
    ) -> Option<Rc<MySQLStatement>> {
        let statement = self.find(query, |statement| statement.accepts(params))?;
        statement.settle(params);
        Some(statement)
    }

    pub(crate) fn insert<P: ExecuteParam>(&self, query: &[u8], params: &[P]) -> Rc<MySQLStatement> {
        let statement = Rc::new(MySQLStatement::new(
            Status::Parsing,
            params
                .iter()
                .map(|param| Cell::new(parameter_type(param)))
                .collect(),
        ));
        self.add(query, Rc::clone(&statement));
        statement
    }
}
