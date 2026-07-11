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

    // No explicit `Drop` impl needed: the `Box<[T]>` fields free the four owned slices automatically.

    // JSError (from QueryBindingIterator /
    // Tag::from_js), OOM, and InvalidQueryBinding are collapsed to the
    // crate-wide `crate::Error`.
    pub fn generate(
        global_object: &JSGlobalObject,
        query: &[u8],
        array_value: JSValue,
        columns: JSValue,
        prepared_statement_id: u64,
        unnamed: bool,
    ) -> crate::Result<Signature> {
        use crate::jsc::js_error_to_postgres;
        use crate::postgres::types::tag_jsc;
        use crate::shared::QueryBindingIterator;
        use bun_sql::postgres::types::tag::Tag;

        let mut fields: Vec<Int4> = Vec::new();
        let mut name: Vec<u8> = Vec::with_capacity(query.len());

        name.extend_from_slice(query);

        let mut iter = QueryBindingIterator::init(array_value, columns, global_object)
            .map_err(js_error_to_postgres)?;

        while let Some(value) = iter.next().map_err(js_error_to_postgres)? {
            if value.is_empty_or_undefined_or_null() {
                // Allow postgres to decide the type
                fields.push(0);
                name.extend_from_slice(b".null");
                continue;
            }

            let tag = tag_jsc::from_js(global_object, value).map_err(js_error_to_postgres)?;

            match tag {
                Tag::int8 => name.extend_from_slice(b".int8"),
                Tag::int4 => name.extend_from_slice(b".int4"),
                // Tag::int4_array => name.extend_from_slice(b".int4_array"),
                Tag::int2 => name.extend_from_slice(b".int2"),
                Tag::float8 => name.extend_from_slice(b".float8"),
                Tag::float4 => name.extend_from_slice(b".float4"),
                Tag::numeric => name.extend_from_slice(b".numeric"),
                Tag::json | Tag::jsonb => name.extend_from_slice(b".json"),
                Tag::bool => name.extend_from_slice(b".bool"),
                Tag::timestamp => name.extend_from_slice(b".timestamp"),
                Tag::timestamptz => name.extend_from_slice(b".timestamptz"),
                Tag::bytea => name.extend_from_slice(b".bytea"),
                _ => name.extend_from_slice(b".string"),
            }

            match tag {
                Tag::bool
                | Tag::int4
                | Tag::int8
                | Tag::float8
                | Tag::int2
                | Tag::numeric
                | Tag::float4
                | Tag::bytea => {
                    // We decide the type
                    fields.push(Int4::from(tag.0));
                }
                _ => {
                    // Allow postgres to decide the type
                    fields.push(0);
                }
            }
        }

        if iter.any_failed() {
            return Err(crate::Error::InvalidQueryBinding);
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
