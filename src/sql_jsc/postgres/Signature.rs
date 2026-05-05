use crate::jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::postgres_types::Int4;

#[derive(Default)]
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
        // PORT NOTE: Zig `std.hash.Wyhash.init(0)` + `update` + `final`. The
        // `bun_wyhash` crate exposes the streaming API as `Wyhash11` (and a
        // stateless `hash`); for now use the one-shot `bun_wyhash::hash` over
        // a concatenated byte view.
        // SAFETY: Int4 is POD; reinterpreting &[Int4] as bytes is sound (matches
        // Zig `std.mem.sliceAsBytes`).
        let fields_bytes = unsafe {
            core::slice::from_raw_parts(
                self.fields.as_ptr() as *const u8,
                self.fields.len() * core::mem::size_of::<Int4>(),
            )
        };
        // PERF(port): Zig fed two slices into a streaming Wyhash; bun_wyhash
        // currently lacks the std-compatible streaming `Wyhash` type. Concatenate
        // into a temp Vec until `bun_wyhash::Wyhash` (streaming, seed-0) lands.
        // TODO(b2-blocked): bun_wyhash::Wyhash (streaming std-compatible API)
        let mut buf: Vec<u8> = Vec::with_capacity(self.name.len() + fields_bytes.len());
        buf.extend_from_slice(&self.name);
        buf.extend_from_slice(fields_bytes);
        bun_wyhash::hash(&buf)
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
        #[cfg(any())]
        {
            // TODO(b2-blocked): crate::shared::QueryBindingIterator::{init,next,any_failed}
            // TODO(b2-blocked): bun_jsc::JSValue::is_empty_or_undefined_or_null
            // TODO(b2-blocked): bun_sql::postgres::postgres_types::Tag::from_js
            //   (jsc-side ext trait — Tag is base-crate, from_js needs &JSGlobalObject)
            use crate::shared::QueryBindingIterator;
            use bun_sql::postgres::postgres_types as types;

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

            return Ok(Signature {
                prepared_statement_name,
                name: name.into_boxed_slice(),
                fields: fields.into_boxed_slice(),
                query: Box::<[u8]>::from(query),
            });
        }
        #[cfg(not(any()))]
        {
            let _ = (global_object, query, array_value, columns, prepared_statement_id, unnamed);
            unimplemented!("b2-blocked: QueryBindingIterator / Tag::from_js")
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/Signature.zig (112 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked)
//   notes:      Tag::from_js lives in bun_sql (base crate) but takes &JSGlobalObject — may need *_jsc ext trait; error set mixes JSError+OOM+InvalidQueryBinding
// ──────────────────────────────────────────────────────────────────────────
