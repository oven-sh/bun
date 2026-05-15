use crate::jsc::{JSGlobalObject, JSValue};
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;

use crate::mysql::my_sql_statement::Param;

#[derive(Default)]
pub struct Signature {
    pub fields: Box<[Param]>,
    pub name: Box<[u8]>,
    pub query: Box<[u8]>,
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
        // Hash `name` followed by each param's `(type, flags)` field-by-field.
        //
        // This intentionally does NOT reinterpret `&[Param]` as `&[u8]` (the Zig
        // port originally mirrored `std.mem.sliceAsBytes`): `Param` has default
        // `repr(Rust)` with a `u8` enum + `u16` bitflags, leaving one padding
        // byte. Exposing padding through `&[u8]` reads uninitialized memory and
        // is UB. The hash is a process-local prepared-statement cache key, so it
        // only needs to be self-consistent — byte-for-byte layout parity with Zig
        // is not required.
        //
        // PERF(port): Zig fed two slices into a streaming Wyhash; bun_wyhash
        // currently lacks the std-compatible streaming `Wyhash` type. Concatenate
        // into a temp Vec until that lands.
        // TODO(b2-blocked): bun_wyhash::Wyhash (streaming std-compatible API)
        const BYTES_PER_PARAM: usize = 1 /* FieldType */ + 2 /* ColumnFlags */;
        let mut buf: Vec<u8> =
            Vec::with_capacity(self.name.len() + self.fields.len() * BYTES_PER_PARAM);
        buf.extend_from_slice(&self.name);
        for p in self.fields.iter() {
            buf.push(p.r#type as u8);
            buf.extend_from_slice(&p.flags.to_int().to_ne_bytes());
        }
        bun_wyhash::hash(&buf)
    }

    // TODO(port): narrow error set (mixes JS errors, alloc, and InvalidQueryBinding)
    pub fn generate(
        global_object: &JSGlobalObject,
        query: &[u8],
        array_value: JSValue,
        columns: JSValue,
    ) -> Result<Signature, bun_core::Error> {
        use crate::jsc::js_error_to_mysql;
        use crate::shared::query_binding_iterator::QueryBindingIterator;

        let mut fields: Vec<Param> = Vec::new();
        let mut name: Vec<u8> = Vec::with_capacity(query.len());

        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        name.extend_from_slice(query);

        // errdefer { fields.deinit(); name.deinit(); } — deleted: `Vec` drops on `?`.

        let mut iter = QueryBindingIterator::init(array_value, columns, global_object)
            .map_err(js_error_to_mysql)?;

        while let Some(value) = iter.next().map_err(js_error_to_mysql)? {
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
            let tag =
                crate::mysql::my_sql_value::field_type_from_js(global_object, value, &mut unsigned)
                    .map_err(js_error_to_mysql)?;
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
                flags: if unsigned {
                    ColumnFlags::UNSIGNED
                } else {
                    ColumnFlags::empty()
                },
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

// ported from: src/sql_jsc/mysql/protocol/Signature.zig
