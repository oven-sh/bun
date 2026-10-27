use crate::jsc::{JSArrayIterator, JSGlobalObject, JSValue, JsResult};
use bun_sql::postgres::postgres_types::Int4;

#[derive(Default)]
pub struct Signature {
    /// The type Parse declares for each parameter. 0 leaves it to the server.
    pub(crate) fields: Box<[Int4]>,
    pub(crate) prepared_statement_name: Box<[u8]>,
}

impl Signature {
    /// `None` is NULL, which fits every type.
    pub(crate) fn declared_types(
        global_object: &JSGlobalObject,
        values: JSValue,
    ) -> JsResult<Vec<Option<Int4>>> {
        use crate::postgres::types::tag_jsc;

        let mut iter = JSArrayIterator::init(values, global_object)?;
        // Parse takes `u16::MAX` parameters and refuses a longer list.
        let mut declared = Vec::with_capacity((iter.len as usize).min(u16::MAX as usize));
        while let Some(value) = iter.next()? {
            declared.push(if value.is_empty_or_undefined_or_null() {
                None
            } else {
                Some(Int4::from(tag_jsc::from_js(global_object, value)?.0))
            });
        }
        Ok(declared)
    }

    /// `None` is the unnamed statement.
    pub(crate) fn new(declared: &[Option<Int4>], id: Option<u64>) -> Signature {
        Signature {
            fields: declared.iter().map(|oid| oid.unwrap_or(0)).collect(),
            prepared_statement_name: id.map(Self::name).unwrap_or_default(),
        }
    }

    pub(crate) fn renamed(&self, id: u64) -> Signature {
        Signature {
            fields: self.fields.clone(),
            prepared_statement_name: Self::name(id),
        }
    }

    fn name(id: u64) -> Box<[u8]> {
        format!("P{id}").into_bytes().into_boxed_slice()
    }
}
