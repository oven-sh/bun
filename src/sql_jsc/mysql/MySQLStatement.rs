use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue};

use crate::mysql::protocol::Signature;
use crate::shared::CachedStructure;
use crate::shared::sql_data_cell::{Flags as DataCellFlags, dedupe_columns};

use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;

pub use bun_sql::mysql::mysql_param::Param;

bun_core::declare_scope!(MySQLStatement, hidden);

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` → intrusive single-thread refcount.
// Shared ownership is expressed as `bun_ptr::IntrusiveRc<MySQLStatement>`; the
// `ref_count` field below is the embedded counter that `IntrusiveRc` manipulates.
// `ref()`/`deref()` are methods on `IntrusiveRc`, not on this struct.
#[derive(bun_ptr::CellRefCounted)]
pub struct MySQLStatement {
    pub cached_structure: CachedStructure,
    // Private — intrusive refcount invariant; reach via `ref_()`/`deref()` or
    // [`Self::init_exact_refs`] at construction time.
    ref_count: Cell<u32>,
    pub statement_id: u32,
    pub params: Vec<Param>,
    pub params_received: u32,

    pub columns: Vec<ColumnDefinition41>,
    pub columns_received: u32,

    pub signature: Signature,
    pub status: Status,
    pub error_response: ErrorPacket,
    pub execution_flags: ExecutionFlags,
    pub fields_flags: DataCellFlags,
    pub result_count: u64,
}

impl MySQLStatement {
    /// Callers supply the signature and status; every other field takes its default.
    pub fn new(signature: Signature, status: Status) -> Self {
        Self {
            cached_structure: CachedStructure::default(),
            ref_count: Cell::new(1),
            statement_id: 0,
            params: Vec::new(),
            params_received: 0,
            columns: Vec::new(),
            columns_received: 0,
            signature,
            status,
            error_response: ErrorPacket::default(),
            execution_flags: ExecutionFlags::default(),
            fields_flags: DataCellFlags::default(),
            result_count: 0,
        }
    }
}

impl Default for MySQLStatement {
    fn default() -> Self {
        Self::new(Signature::empty(), Status::Parsing)
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
    /// Set the initial intrusive
    /// refcount at construction time, before any `ref_()`/`deref()`. The
    /// `ref_count` field is private (refcount invariant), so callers building
    /// a statement with >1 owner (query + connection-map entry) go through
    /// this instead of writing the field directly.
    #[inline]
    pub(crate) fn init_exact_refs(&mut self, n: u32) {
        debug_assert!(n > 0);
        self.ref_count.set(n);
    }

    pub(crate) fn reset(&mut self) {
        self.result_count = 0;
        self.columns_received = 0;
        self.execution_flags = ExecutionFlags::default();
    }

    pub(crate) fn check_for_duplicate_fields(&mut self) {
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

    // Returning `&CachedStructure`
    // to avoid moving out of `self`; callers may need `.clone()` if they require
    // an owned copy.
    pub(crate) fn structure(
        &mut self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> &CachedStructure {
        if self.cached_structure.has() {
            return &self.cached_structure;
        }
        self.check_for_duplicate_fields();
        self.cached_structure.build_from_columns(
            global_object,
            owner,
            self.columns.iter().map(|c| &c.name_or_index),
        );
        &self.cached_structure
    }
}

impl Drop for MySQLStatement {
    fn drop(&mut self) {
        bun_core::scoped_log!(MySQLStatement, "MySQLStatement deinit");
    }
}
