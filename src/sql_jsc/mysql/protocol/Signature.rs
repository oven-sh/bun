use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::mysql::my_sql_types::{self as types, FieldType};
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;

use crate::mysql::my_sql_statement::Param;
use crate::shared::query_binding_iterator::QueryBindingIterator;

pub struct Signature {
    pub fields: Box<[Param]>,
    pub name: Box<[u8]>,
    pub query: Box<[u8]>,
}

impl Default for Signature {
    fn default() -> Self {
        Self {
            fields: Box::default(),
            name: Box::default(),
            query: Box::default(),
        }
    }
}

impl Signature {
    pub fn empty() -> Signature {
        Signature {
            fields: Box::default(),
            name: Box::default(),
            query: Box::default(),
        }
    }

    // `deinit` deleted — body only freed owned slices; `Box<[T]>` fields drop automatically.

    pub fn hash(&self) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        hasher.update(&self.name);
        // SAFETY: reinterpreting `[Param]` as raw bytes for hashing, matching Zig
        // `std.mem.sliceAsBytes`. `Param` is a POD value; any padding bytes are
        // hashed identically on both sides.
        let fields_bytes = unsafe {
            core::slice::from_raw_parts(
                self.fields.as_ptr() as *const u8,
                core::mem::size_of_val::<[Param]>(&self.fields),
            )
        };
        hasher.update(fields_bytes);
        hasher.finish()
    }

    // TODO(port): narrow error set (mixes JS errors, alloc, and InvalidQueryBinding)
    pub fn generate(
        global_object: &JSGlobalObject,
        query: &[u8],
        array_value: JSValue,
        columns: JSValue,
    ) -> Result<Signature, bun_core::Error> {
        let mut fields: Vec<Param> = Vec::new();
        let mut name: Vec<u8> = Vec::with_capacity(query.len());

        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        name.extend_from_slice(query);

        // errdefer { fields.deinit(); name.deinit(); } — deleted: `Vec` drops on `?`.

        let mut iter = QueryBindingIterator::init(array_value, columns, global_object)?;

        while let Some(value) = iter.next()? {
            if value.is_empty_or_undefined_or_null() {
                // Allow MySQL to decide the type
                fields.push(Param {
                    r#type: FieldType::MYSQL_TYPE_NULL,
                    flags: ColumnFlags::empty(),
                });
                name.extend_from_slice(b".null");
                continue;
            }
            let mut unsigned = false;
            let tag = types::FieldType::from_js(global_object, value, &mut unsigned)?;
            if unsigned {
                // 128 is more than enought right now
                // PORT NOTE: reshaped — Zig used `std.fmt.bufPrint` into a 128-byte
                // stack buffer with a `catch @tagName(tag)` fallback on overflow.
                // "U" + tag name can never exceed 128 bytes, so a direct append is
                // equivalent and avoids the intermediate buffer.
                name.push(b'U');
                name.extend_from_slice(<&'static str>::from(tag).as_bytes());
            } else {
                name.extend_from_slice(<&'static str>::from(tag).as_bytes());
            }
            // TODO: add flags if necessary right now the only relevant would be unsigned but is JS and is never unsigned
            fields.push(Param {
                r#type: tag,
                // TODO(port): assumes ColumnFlags ports as `bitflags!` (packed struct of bools)
                flags: if unsigned { ColumnFlags::UNSIGNED } else { ColumnFlags::empty() },
            });
        }

        if iter.any_failed() {
            return Err(bun_core::err!("InvalidQueryBinding"));
        }

        Ok(Signature {
            name: name.into_boxed_slice(),
            fields: fields.into_boxed_slice(),
            query: Box::<[u8]>::from(query),
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/protocol/Signature.zig (86 lines)
//   confidence: medium
//   todos:      2
//   notes:      ColumnFlags assumed bitflags! port; bufPrint reshaped to direct append; deinit folded into Drop-by-field.
// ──────────────────────────────────────────────────────────────────────────
