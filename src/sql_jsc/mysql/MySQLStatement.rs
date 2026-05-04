use core::cell::Cell;

use bun_collections::StringHashMap;
use bun_jsc::{JSGlobalObject, JSObject, JSValue};
use bun_jsc::object::ExternColumnIdentifier;
use bun_str::String;

use crate::shared::CachedStructure;
use crate::shared::SQLDataCell;
use crate::mysql::protocol::Signature;

use bun_sql::mysql::protocol::ColumnDefinition41;
use bun_sql::mysql::protocol::column_definition41::{ColumnFlags, NameOrIndex};
use bun_sql::mysql::protocol::ErrorPacket;
use bun_sql::mysql::MySQLTypes as types;

pub use bun_sql::mysql::MySQLParam::Param;

bun_output::declare_scope!(MySQLStatement, hidden);

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` → intrusive single-thread refcount.
// Shared ownership is expressed as `bun_ptr::IntrusiveRc<MySQLStatement>`; the
// `ref_count` field below is the embedded counter that `IntrusiveRc` manipulates.
// `ref()`/`deref()` are methods on `IntrusiveRc`, not on this struct.
pub struct MySQLStatement {
    pub cached_structure: CachedStructure,
    pub ref_count: Cell<u32>,
    pub statement_id: u32,
    pub params: Vec<Param>,
    pub params_received: u32,

    pub columns: Vec<ColumnDefinition41>,
    pub columns_received: u32,

    pub signature: Signature,
    pub status: Status,
    pub error_response: ErrorPacket,
    pub execution_flags: ExecutionFlags,
    pub fields_flags: SQLDataCell::Flags,
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
            error_response: ErrorPacket { error_code: 0, ..Default::default() },
            execution_flags: ExecutionFlags::default(),
            fields_flags: SQLDataCell::Flags::default(),
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
    pub fn reset(&mut self) {
        self.result_count = 0;
        self.columns_received = 0;
        self.execution_flags = ExecutionFlags::default();
    }

    pub fn check_for_duplicate_fields(&mut self) {
        if !self.execution_flags.contains(ExecutionFlags::NEEDS_DUPLICATE_CHECK) {
            return;
        }
        self.execution_flags.remove(ExecutionFlags::NEEDS_DUPLICATE_CHECK);

        let mut seen_numbers: Vec<u32> = Vec::new();
        // TODO(port): StringHashMap key lifetime — Zig stores borrowed `name.slice()` pointers
        // that outlive the map (columns outlive this function). In Rust this needs either
        // `StringHashMap<'a, ()>` borrowing from `self.columns` or owned keys; using owned
        // `Vec<u8>` keys here for now.
        let mut seen_fields: StringHashMap<()> = StringHashMap::default();
        seen_fields.reserve(self.columns.len());

        // iterate backwards
        let mut remaining = self.columns.len();
        let mut flags = SQLDataCell::Flags::default();
        while remaining > 0 {
            remaining -= 1;
            let field: &mut ColumnDefinition41 = &mut self.columns[remaining];
            match &field.name_or_index {
                NameOrIndex::Name(name) => {
                    // PORT NOTE: reshaped for borrowck — compute `found_existing` before
                    // mutating `field.name_or_index`.
                    let found_existing = {
                        let entry = seen_fields.get_or_put(name.slice());
                        entry.found_existing
                    };
                    if found_existing {
                        // Zig: field.name_or_index.deinit(); — Drop on assignment handles this.
                        field.name_or_index = NameOrIndex::Duplicate;
                        flags.has_duplicate_columns = true;
                    }

                    flags.has_named_columns = true;
                }
                NameOrIndex::Index(index) => {
                    let index = *index;
                    if seen_numbers.iter().any(|&n| n == index) {
                        field.name_or_index = NameOrIndex::Duplicate;
                        flags.has_duplicate_columns = true;
                    } else {
                        seen_numbers.push(index);
                    }

                    flags.has_indexed_columns = true;
                }
                NameOrIndex::Duplicate => {
                    flags.has_duplicate_columns = true;
                }
            }
        }

        self.fields_flags = flags;
    }

    // PORT NOTE: Zig returns `CachedStructure` by value (struct copy). Returning `&CachedStructure`
    // here to avoid moving out of `self`; callers in Phase B may need `.clone()` if they require
    // an owned copy.
    pub fn structure(&mut self, owner: JSValue, global_object: &JSGlobalObject) -> &CachedStructure {
        if self.cached_structure.has() {
            return &self.cached_structure;
        }
        self.check_for_duplicate_fields();

        // lets avoid most allocations
        // TODO(port): requires `ExternColumnIdentifier: Copy` (Zig: `.{ .tag = 0, .value = .{ .index = 0 } }` x70)
        let mut stack_ids: [ExternColumnIdentifier; 70] = [ExternColumnIdentifier::default(); 70];
        // lets de duplicate the fields early
        let mut non_duplicated_count = self.columns.len();
        for column in &self.columns {
            if matches!(column.name_or_index, NameOrIndex::Duplicate) {
                non_duplicated_count -= 1;
            }
        }

        let max_inline = JSObject::max_inline_capacity();
        let mut heap_ids: Vec<ExternColumnIdentifier>;
        let ids: &mut [ExternColumnIdentifier] = if non_duplicated_count <= max_inline {
            &mut stack_ids[..non_duplicated_count]
        } else {
            heap_ids = vec![ExternColumnIdentifier::default(); non_duplicated_count];
            &mut heap_ids[..]
        };

        let mut i: usize = 0;
        for column in &self.columns {
            if matches!(column.name_or_index, NameOrIndex::Duplicate) {
                continue;
            }

            let id: &mut ExternColumnIdentifier = &mut ids[i];
            match &column.name_or_index {
                NameOrIndex::Name(name) => {
                    id.value.name = String::create_atom_if_possible(name.slice());
                }
                NameOrIndex::Index(index) => {
                    id.value.index = *index;
                }
                NameOrIndex::Duplicate => unreachable!(),
            }

            id.tag = match column.name_or_index {
                NameOrIndex::Name(_) => 2,
                NameOrIndex::Index(_) => 1,
                NameOrIndex::Duplicate => 0,
            };

            i += 1;
        }

        if non_duplicated_count > max_inline {
            // TODO(port): ownership transfer of heap `ids` to CachedStructure — Zig passes the
            // allocated slice and CachedStructure becomes responsible for freeing it.
            self.cached_structure.set(global_object, None, Some(ids));
        } else {
            self.cached_structure.set(
                global_object,
                Some(JSObject::create_structure(
                    global_object,
                    owner,
                    ids.len() as u32,
                    ids.as_mut_ptr(),
                )),
                None,
            );
        }

        &self.cached_structure
    }
}

impl Drop for MySQLStatement {
    fn drop(&mut self) {
        bun_output::scoped_log!(MySQLStatement, "MySQLStatement deinit");
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLStatement.zig (185 lines)
//   confidence: medium
//   todos:      4
//   notes:      IntrusiveRc refcount; ExecutionFlags as bitflags w/ non-zero Default; StringHashMap key lifetime + CachedStructure ids ownership need Phase B review; structure() returns &CachedStructure instead of by-value.
// ──────────────────────────────────────────────────────────────────────────
