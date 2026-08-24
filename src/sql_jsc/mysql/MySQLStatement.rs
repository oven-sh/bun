use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsCell};

use crate::mysql::protocol::Signature;
use crate::shared::CachedStructure;
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;

pub use bun_sql::mysql::mysql_param::Param;

bun_core::declare_scope!(MySQLStatement, hidden);

// Intrusive single-thread refcount (`CellRefCounted`). Shared between the owning query and the connection's prepared-statement map
// (each holds a `RefPtr`), so every field written after construction is
// interior-mutable and the statement is only ever reached as `&Self`.
#[derive(bun_ptr::CellRefCounted)]
pub struct MySQLStatement {
    pub(crate) cached_structure: JsCell<CachedStructure>,
    ref_count: Cell<u32>,
    pub(crate) statement_id: Cell<u32>,
    pub(crate) params: JsCell<Vec<Param>>,
    pub(crate) params_received: Cell<u32>,

    pub(crate) columns: JsCell<Vec<ColumnDefinition41>>,
    pub(crate) columns_received: Cell<u32>,

    pub(crate) signature: Signature,
    pub(crate) status: Cell<Status>,
    pub(crate) error_response: JsCell<ErrorPacket>,
    pub(crate) execution_flags: Cell<ExecutionFlags>,
    pub(crate) fields_flags: Cell<DataCellFlags>,
    pub(crate) result_count: Cell<u64>,
}

impl MySQLStatement {
    /// A new statement with one ref, owned by the returned handle; every other
    /// field takes its default.
    pub(crate) fn new(signature: Signature, status: Status) -> bun_ptr::RefPtr<Self> {
        bun_ptr::RefPtr::new(Self {
            cached_structure: JsCell::new(CachedStructure::default()),
            ref_count: Cell::new(1),
            statement_id: Cell::new(0),
            params: JsCell::new(Vec::new()),
            params_received: Cell::new(0),
            columns: JsCell::new(Vec::new()),
            columns_received: Cell::new(0),
            signature,
            status: Cell::new(status),
            error_response: JsCell::new(ErrorPacket::default()),
            execution_flags: Cell::new(ExecutionFlags::default()),
            fields_flags: Cell::new(DataCellFlags::default()),
            result_count: Cell::new(0),
        })
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct ExecutionFlags: u8 {
        const HEADER_RECEIVED      = 1 << 0;
        const NEEDS_DUPLICATE_CHECK = 1 << 1;
        const NEED_TO_SEND_PARAMS  = 1 << 2;
        /// In legacy protocol (CLIENT_DEPRECATE_EOF not negotiated), tracks whether
        /// the intermediate EOF packet between column definitions and row data has
        /// been consumed. This prevents the intermediate EOF from being mistakenly
        /// treated as end-of-result-set.
        const COLUMNS_EOF_RECEIVED = 1 << 3;
    }
}

impl Default for ExecutionFlags {
    fn default() -> Self {
        ExecutionFlags::NEEDS_DUPLICATE_CHECK | ExecutionFlags::NEED_TO_SEND_PARAMS
    }
}

pub use bun_sql::shared::statement_status::Status;

impl MySQLStatement {
    #[inline]
    pub(crate) fn has_execution_flag(&self, flag: ExecutionFlags) -> bool {
        self.execution_flags.get().contains(flag)
    }

    #[inline]
    pub(crate) fn insert_execution_flag(&self, flag: ExecutionFlags) {
        let mut flags = self.execution_flags.get();
        flags.insert(flag);
        self.execution_flags.set(flags);
    }

    #[inline]
    pub(crate) fn remove_execution_flag(&self, flag: ExecutionFlags) {
        let mut flags = self.execution_flags.get();
        flags.remove(flag);
        self.execution_flags.set(flags);
    }

    pub(crate) fn reset(&self) {
        self.result_count.set(0);
        self.columns_received.set(0);
        self.execution_flags.set(ExecutionFlags::default());
    }

    fn check_for_duplicate_fields(&self) {
        if !self.has_execution_flag(ExecutionFlags::NEEDS_DUPLICATE_CHECK) {
            return;
        }
        self.remove_execution_flag(ExecutionFlags::NEEDS_DUPLICATE_CHECK);

        let flags = self.columns.with_mut(|columns| {
            dedupe_columns(columns.iter_mut().rev().map(|c| &mut c.name_or_index))
        });
        self.fields_flags.set(flags);
    }

    /// The cached JSC structure for this statement's columns, building it on
    /// first use.
    pub(crate) fn structure(
        &self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> &CachedStructure {
        if !self.cached_structure.get().has() {
            self.check_for_duplicate_fields();
            let columns = self.columns.get();
            self.cached_structure.with_mut(|cs| {
                cs.build_from_columns(
                    global_object,
                    owner,
                    columns.iter().map(|c| &c.name_or_index),
                )
            });
        }
        self.cached_structure.get()
    }
}

impl Drop for MySQLStatement {
    fn drop(&mut self) {
        bun_core::scoped_log!(MySQLStatement, "MySQLStatement deinit");
    }
}
