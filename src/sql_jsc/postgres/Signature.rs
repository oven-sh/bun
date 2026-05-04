use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::postgres_types as types;
use bun_sql::postgres::postgres_types::Int4;
use crate::shared::QueryBindingIterator;

pub struct Signature {
    pub fields: Box<[Int4]>,
    pub name: Box<[u8]>,
    pub query: Box<[u8]>,
    pub prepared_statement_name: Box<[u8]>,
}

impl Signature {
    pub fn empty() -> Signature {
        Signature {
            fields: Box::default(),
            name: Box::default(),
            query: Box::default(),
            prepared_statement_name: Box::default(),
        }
    }

    // PORT NOTE: Zig `deinit` only freed the four owned slices via
    // `bun.default_allocator.free`. With `Box<[T]>` fields, Rust's `Drop`
    // handles this automatically — no explicit `Drop` impl needed.

    pub fn hash(&self) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::new(0);
        hasher.update(&self.name);
        // SAFETY: Int4 is POD; reinterpreting &[Int4] as bytes is sound (matches
        // Zig `std.mem.sliceAsBytes`).
        let fields_bytes = unsafe {
            core::slice::from_raw_parts(
                self.fields.as_ptr() as *const u8,
                self.fields.len() * core::mem::size_of::<Int4>(),
            )
        };
        hasher.update(fields_bytes);
        hasher.finish()
    }

    // TODO(port): narrow error set — Zig inferred set mixes JSError (from
    // QueryBindingIterator / Tag::from_js), OOM, and error.InvalidQueryBinding.
    pub fn generate(
        global_object: &JSGlobalObject,
        query: &[u8],
        array_value: JSValue,
        columns: JSValue,
        prepared_statement_id: u64,
        unnamed: bool,
    ) -> Result<Signature, bun_core::Error> {
        let mut fields: Vec<Int4> = Vec::new();
        let mut name: Vec<u8> = Vec::with_capacity(query.len());

        name.extend_from_slice(query);
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B

        // (errdefer { fields.deinit(); name.deinit(); } — handled by Drop on `?`)

        let mut iter = QueryBindingIterator::init(array_value, columns, global_object)?;

        while let Some(value) = iter.next()? {
            if value.is_empty_or_undefined_or_null() {
                // Allow postgres to decide the type
                fields.push(0);
                name.extend_from_slice(b".null");
                continue;
            }

            let tag = types::Tag::from_js(global_object, value)?;

            match tag {
                types::Tag::Int8 => name.extend_from_slice(b".int8"),
                types::Tag::Int4 => name.extend_from_slice(b".int4"),
                // types::Tag::Int4Array => name.extend_from_slice(b".int4_array"),
                types::Tag::Int2 => name.extend_from_slice(b".int2"),
                types::Tag::Float8 => name.extend_from_slice(b".float8"),
                types::Tag::Float4 => name.extend_from_slice(b".float4"),
                types::Tag::Numeric => name.extend_from_slice(b".numeric"),
                types::Tag::Json | types::Tag::Jsonb => name.extend_from_slice(b".json"),
                types::Tag::Bool => name.extend_from_slice(b".bool"),
                types::Tag::Timestamp => name.extend_from_slice(b".timestamp"),
                types::Tag::Timestamptz => name.extend_from_slice(b".timestamptz"),
                types::Tag::Bytea => name.extend_from_slice(b".bytea"),
                _ => name.extend_from_slice(b".string"),
            }

            match tag {
                types::Tag::Bool
                | types::Tag::Int4
                | types::Tag::Int8
                | types::Tag::Float8
                | types::Tag::Int2
                | types::Tag::Numeric
                | types::Tag::Float4
                | types::Tag::Bytea => {
                    // We decide the type
                    fields.push(tag as Int4);
                }
                _ => {
                    // Allow postgres to decide the type
                    fields.push(0);
                }
            }
        }

        if iter.any_failed() {
            return Err(bun_core::err!("InvalidQueryBinding"));
        }
        // max u64 length is 20, max prepared_statement_name length is 63
        let prepared_statement_name: Box<[u8]> = if unnamed {
            Box::default()
        } else {
            use std::io::Write;
            let mut v: Vec<u8> = Vec::new();
            write!(
                &mut v,
                "P{}${}",
                bstr::BStr::new(&name[..name.len().min(40)]),
                prepared_statement_id,
            )
            .expect("unreachable");
            v.into_boxed_slice()
        };

        Ok(Signature {
            prepared_statement_name,
            name: name.into_boxed_slice(),
            fields: fields.into_boxed_slice(),
            query: Box::<[u8]>::from(query),
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/Signature.zig (112 lines)
//   confidence: medium
//   todos:      1
//   notes:      Tag::from_js lives in bun_sql (base crate) but takes &JSGlobalObject — may need *_jsc ext trait; error set mixes JSError+OOM+InvalidQueryBinding
// ──────────────────────────────────────────────────────────────────────────
