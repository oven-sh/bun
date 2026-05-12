use core::cell::Cell;
use core::mem::{ManuallyDrop, MaybeUninit};

use bun_collections::StringHashMap;
use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSObject, JSValue, JsResult};

use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use crate::shared::sql_data_cell::Flags as DataCellFlags;
use crate::postgres::error_jsc::postgres_error_to_js;
use crate::postgres::signature::Signature;

use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::int4;
use bun_sql::shared::ColumnIdentifier;

bun_core::declare_scope!(Postgres, visible);

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread refcount.
// Ported as an embedded `Cell<u32>` driven by `bun_ptr::IntrusiveRc<PostgresSQLStatement>`;
// `ref`/`deref` are provided by `IntrusiveRc`, not as inherent methods.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLStatement {
    pub cached_structure: PostgresCachedStructure,
    // Private — intrusive refcount invariant; reach via `ref_()`/`deref()` or
    // [`Self::init_exact_refs`] at construction time.
    ref_count: Cell<u32>,
    pub fields: Vec<protocol::FieldDescription>,
    pub parameters: Box<[int4]>,
    pub signature: Signature,
    pub status: Status,
    pub error_response: Option<Error>,
    pub needs_duplicate_check: bool,
    pub fields_flags: DataCellFlags,
}

impl Default for PostgresSQLStatement {
    fn default() -> Self {
        // TODO(port): `signature` has no default in Zig; callers must set it. This Default
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
        }
    }
}

pub enum Error {
    Protocol(protocol::ErrorResponse),
    PostgresError(AnyPostgresError),
}

impl Error {
    // Zig `deinit` only forwarded to `ErrorResponse.deinit()`; that is now `Drop` on
    // `protocol::ErrorResponse`, so no explicit `Drop` impl is needed here.

    pub fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Error::Protocol(err) => {
                Ok(crate::postgres::protocol::error_response_jsc::to_js(err, global_object))
            }
            Error::PostgresError(err) => Ok(postgres_error_to_js(global_object, None, *err)),
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Pending,
    Parsing,
    Prepared,
    Failed,
}

impl Status {
    pub fn is_running(self) -> bool {
        self == Status::Parsing
    }
}

impl PostgresSQLStatement {
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

    pub fn check_for_duplicate_fields(&mut self) {
        if !self.needs_duplicate_check {
            return;
        }
        self.needs_duplicate_check = false;

        let mut seen_numbers: Vec<u32> = Vec::new();
        let mut seen_fields: StringHashMap<()> = StringHashMap::default();
        seen_fields.reserve(self.fields.len());

        // iterate backwards
        let mut remaining = self.fields.len();
        let mut flags = DataCellFlags::default();
        while remaining > 0 {
            remaining -= 1;
            let field: &mut protocol::FieldDescription = &mut self.fields[remaining];
            match &field.name_or_index {
                ColumnIdentifier::Name(name) => {
                    // PORT NOTE: reshaped for borrowck — compute `found_existing`
                    // before mutating `field.name_or_index`.
                    // TODO(port): Zig `getOrPut` keys on the borrowed slice;
                    // StringHashMap clones to an owned `Box<[u8]>` key. Fine for
                    // a transient dedup set; revisit if profiling flags it.
                    let found_existing = seen_fields
                        .get_or_put(name.slice())
                        .expect("OOM")
                        .found_existing;
                    if found_existing {
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

    // PORT NOTE: Zig returns `CachedStructure` by value (struct copy). Returning
    // `&CachedStructure` here to avoid moving out of `self` (CachedStructure owns
    // a `Box<[ExternColumnIdentifier]>` and a `StrongOptional`, neither `Copy`).
    pub fn structure(
        &mut self,
        owner: JSValue,
        global_object: &JSGlobalObject,
    ) -> &PostgresCachedStructure {
        if self.cached_structure.has() {
            return &self.cached_structure;
        }
        self.check_for_duplicate_fields();

        // lets avoid most allocations
        // SAFETY: `[MaybeUninit<T>; N]` is always sound to `assume_init` — every
        // element is itself `MaybeUninit` and thus has no validity invariant.
        let mut stack_ids: [MaybeUninit<ExternColumnIdentifier>; 70] =
            unsafe { MaybeUninit::uninit().assume_init() };
        // lets de duplicate the fields early
        let mut non_duplicated_count = self.fields.len();
        for field in &self.fields {
            if matches!(field.name_or_index, ColumnIdentifier::Duplicate) {
                non_duplicated_count -= 1;
            }
        }

        let max_inline = JSObject::max_inline_capacity() as usize;
        // PORT NOTE: initialized to empty so the `> max_inline` branch below can
        // unconditionally `into_boxed_slice()` it; in the `<= max_inline` branch
        // it stays empty and is never read.
        let mut heap_ids: Vec<ExternColumnIdentifier> = Vec::new();
        let ids: &mut [MaybeUninit<ExternColumnIdentifier>] = if non_duplicated_count <= max_inline {
            &mut stack_ids[0..non_duplicated_count]
        } else {
            heap_ids = Vec::with_capacity(non_duplicated_count);
            // Spare capacity is exactly the uninitialized `[MaybeUninit<T>]` view
            // we need; fully initialized in the loop below before any read.
            &mut heap_ids.spare_capacity_mut()[..non_duplicated_count]
        };

        let mut i: usize = 0;
        for field in &self.fields {
            if matches!(field.name_or_index, ColumnIdentifier::Duplicate) {
                continue;
            }

            let mut out = ExternColumnIdentifier::default();
            match &field.name_or_index {
                ColumnIdentifier::Name(name) => {
                    out.value.name =
                        ManuallyDrop::new(bun_core::String::create_atom_if_possible(name.slice()));
                }
                ColumnIdentifier::Index(index) => {
                    out.value.index = *index;
                }
                ColumnIdentifier::Duplicate => unreachable!(),
            }
            out.tag = match field.name_or_index {
                ColumnIdentifier::Name(_) => 2,
                ColumnIdentifier::Index(_) => 1,
                ColumnIdentifier::Duplicate => 0,
            };
            ids[i].write(out);
            i += 1;
        }

        if non_duplicated_count > max_inline {
            // SAFETY: `heap_ids` has capacity `non_duplicated_count` and every
            // slot in [0..non_duplicated_count] was initialized in the loop above.
            unsafe { heap_ids.set_len(non_duplicated_count) };
            // Ownership transfer of heap `ids` to CachedStructure (Zig: cached_structure
            // becomes responsible for freeing the alloc'd slice).
            self.cached_structure
                .set(global_object, None, Some(heap_ids.into_boxed_slice()));
        } else {
            // Every element in `ids[..]` was `.write()`n above; C++ reads them as
            // `ExternColumnIdentifier` by raw pointer, so pass the buffer through
            // without materialising a typed slice (avoids an unsafe assume-init cast).
            self.cached_structure.set(
                global_object,
                Some(JSObject::create_structure(
                    global_object,
                    owner,
                    ids.len() as u32,
                    ids.as_mut_ptr().cast::<ExternColumnIdentifier>(),
                )),
                None,
            );
        }

        &self.cached_structure
    }
}

impl Drop for PostgresSQLStatement {
    fn drop(&mut self) {
        bun_core::scoped_log!(Postgres, "PostgresSQLStatement deinit");

        debug_assert_eq!(self.ref_count.get(), 0, "ref_count.assertNoRefs()");

        // `fields` (Vec<FieldDescription>): each element's Drop runs, then the buffer frees.
        // `parameters` (Box<[int4]>): freed by Drop.
        // `cached_structure`, `error_response`, `signature`: Drop.
        // `bun.default_allocator.destroy(this)`: handled by `bun_ptr::IntrusiveRc` dealloc,
        // not here — Drop must not free `self`'s storage.
    }
}

// ported from: src/sql_jsc/postgres/PostgresSQLStatement.zig
