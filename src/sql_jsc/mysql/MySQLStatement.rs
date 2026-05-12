use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue};
use bun_collections::StringHashMap;

use crate::mysql::protocol::Signature;
use crate::shared::CachedStructure;
use crate::shared::sql_data_cell::Flags as DataCellFlags;

use bun_sql::mysql::mysql_types as types;
use bun_sql::mysql::protocol::column_definition41::{ColumnDefinition41, ColumnFlags};
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::shared::ColumnIdentifier;

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

impl Default for MySQLStatement {
    fn default() -> Self {
        Self {
            cached_structure: CachedStructure::default(),
            ref_count: Cell::new(1),
            statement_id: 0,
            params: Vec::new(),
            params_received: 0,
            columns: Vec::new(),
            columns_received: 0,
            // TODO(port): Signature has no Zig default; callers must supply it. This Default
            // impl exists only to mirror Zig's per-field defaults — prefer a `new(signature)`
            // constructor in Phase B.
            signature: Signature::default(),
            status: Status::Parsing,
            error_response: ErrorPacket::default(),
            execution_flags: ExecutionFlags::default(),
            fields_flags: DataCellFlags::default(),
            result_count: 0,
        }
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
        // _: u4 padding in Zig — unused high bits.
    }
}

impl Default for ExecutionFlags {
    fn default() -> Self {
        // Zig: header_received=false, needs_duplicate_check=true, need_to_send_params=true, columns_eof_received=false
        ExecutionFlags::NEEDS_DUPLICATE_CHECK | ExecutionFlags::NEED_TO_SEND_PARAMS
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pending,
    Parsing,
    Prepared,
    Failed,
}

impl MySQLStatement {
    /// Zig `.ref_count = .initExactRefs(n)` — set the initial intrusive
    /// refcount at construction time, before any `ref_()`/`deref()`. The
    /// `ref_count` field is private (refcount invariant), so callers building
    /// a statement with >1 owner (query + connection-map entry) go through
    /// this instead of writing the field directly.
    #[inline]
    pub fn init_exact_refs(&mut self, n: u32) {
        debug_assert!(n > 0);
        self.ref_count.set(n);
    }

    pub fn reset(&mut self) {
        self.result_count = 0;
        self.columns_received = 0;
        self.execution_flags = ExecutionFlags::default();
    }

    pub fn check_for_duplicate_fields(&mut self) {
        if !self
            .execution_flags
            .contains(ExecutionFlags::NEEDS_DUPLICATE_CHECK)
        {
            return;
        }
        self.execution_flags
            .remove(ExecutionFlags::NEEDS_DUPLICATE_CHECK);

        let mut seen_numbers: Vec<u32> = Vec::new();
        // TODO(port): StringHashMap key lifetime — Zig stores borrowed `name.slice()` pointers
        // that outlive the map (columns outlive this function). The Rust StringHashMap clones
        // into owned `Box<[u8]>` keys; fine for a transient dedup set.
        let mut seen_fields: StringHashMap<()> = StringHashMap::default();
        seen_fields.reserve(self.columns.len());

        // iterate backwards
        let mut remaining = self.columns.len();
        let mut flags = DataCellFlags::default();
        while remaining > 0 {
            remaining -= 1;
            let field: &mut ColumnDefinition41 = &mut self.columns[remaining];
            match &field.name_or_index {
                ColumnIdentifier::Name(name) => {
                    // PORT NOTE: reshaped for borrowck — compute `found_existing` before
                    // mutating `field.name_or_index`.
                    let found_existing = seen_fields
                        .get_or_put(name.slice())
                        .expect("OOM")
                        .found_existing;
                    if found_existing {
                        // Zig: field.name_or_index.deinit(); — Drop on assignment handles this.
                        field.name_or_index = ColumnIdentifier::Duplicate;
                        flags.insert(DataCellFlags::HAS_DUPLICATE_COLUMNS);
                    }

                    flags.insert(DataCellFlags::HAS_NAMED_COLUMNS);
                }
                ColumnIdentifier::Index(index) => {
                    let index = *index;
                    if seen_numbers.iter().any(|&n| n == index) {
                        field.name_or_index = ColumnIdentifier::Duplicate;
                        flags.insert(DataCellFlags::HAS_DUPLICATE_COLUMNS);
                    } else {
                        seen_numbers.push(index);
                    }

                    flags.insert(DataCellFlags::HAS_INDEXED_COLUMNS);
                }
                ColumnIdentifier::Duplicate => {
                    flags.insert(DataCellFlags::HAS_DUPLICATE_COLUMNS);
                }
            }
        }

        self.fields_flags = flags;
    }

    // PORT NOTE: Zig returns `CachedStructure` by value (struct copy). Returning `&CachedStructure`
    // here to avoid moving out of `self`; callers in Phase B may need `.clone()` if they require
    // an owned copy.
    pub fn structure(
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
        // Zig deinit body:
        //   - per-column deinit + free(columns)  → Vec<ColumnDefinition41> Drop
        //   - free(params)                       → Vec<Param> Drop
        //   - cached_structure.deinit()          → field Drop
        //   - error_response.deinit()            → field Drop
        //   - signature.deinit()                 → field Drop
        //   - bun.destroy(this)                  → handled by IntrusiveRc when refcount hits 0
    }
}

#[allow(dead_code)]
struct ParamUnused {
    r#type: types::FieldType,
    flags: ColumnFlags,
}

// ported from: src/sql_jsc/mysql/MySQLStatement.zig
