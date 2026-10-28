use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::strings;

use crate::shared::cached_structure::CachedStructure as PostgresCachedStructure;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types as types;
use bun_sql::postgres::postgres_types::AnyPostgresError;
use bun_sql::shared::data::Data;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as PostgresSQLQueryResultMode;

pub(crate) use crate::shared::sql_data_cell::SQLDataCell;
use crate::shared::sql_data_cell::{Flags, Tag, Value};

type Result<T, E = AnyPostgresError> = core::result::Result<T, E>;

bun_core::declare_scope!(Postgres, visible);

/// The StartupMessage pins DateStyle=ISO; a style the session chose later reads as Invalid Date.
fn parse_date_time_text(bytes: &[u8], global_object: &JSGlobalObject) -> f64 {
    use crate::postgres::types::date;
    date::parse_infinity(bytes)
        .or_else(|| date::timestamptz_text_to_ms_utc(global_object, bytes))
        .unwrap_or(f64::NAN)
}

fn parse_bytea(hex: &[u8]) -> Result<SQLDataCell> {
    let len = hex.len() / 2;
    let mut buf: Vec<u8> = Vec::new();
    buf.try_reserve_exact(len)
        .map_err(|_| AnyPostgresError::OutOfMemory)?;
    // SAFETY: the decoder only writes into the spare bytes and returns how many it filled.
    let written = unsafe {
        bun_core::vec::fill_spare(&mut buf, 0, |spare| {
            match bun_core::decode_hex_to_bytes(&mut spare[..len], hex) {
                Ok(written) => (written, Ok(written)),
                Err(_) => (0, Err(AnyPostgresError::InvalidByteSequence)),
            }
        })
    }?;
    // `SQLDataCell::deinit` frees this as a `Box<[u8]>` of exactly `written` bytes.
    let ptr = bun_core::heap::into_raw(buf.into_boxed_slice()).cast::<u8>();

    Ok(SQLDataCell {
        tag: Tag::Bytea,
        value: Value {
            bytea: [ptr as usize, written],
        },
        free_value: 1,
        ..Default::default()
    })
}

/// `MAXDIM` of the server.
const MAX_ARRAY_DIMENSIONS: usize = 6;

struct ArrayCells(Vec<SQLDataCell>);

impl ArrayCells {
    fn into_cell(mut self) -> Result<SQLDataCell> {
        if self.0.capacity() > u32::MAX as usize {
            return Err(AnyPostgresError::UnsupportedArrayFormat);
        }
        Ok(SQLDataCell::array(core::mem::take(&mut self.0)))
    }
}

impl Drop for ArrayCells {
    fn drop(&mut self) {
        for cell in &mut self.0 {
            cell.deinit();
        }
    }
}

/// Appends the digits at the start of `bytes` to `value`. Returns what follows them.
fn digits<'a>(mut bytes: &'a [u8], value: &mut u64) -> &'a [u8] {
    while let [digit @ b'0'..=b'9', rest @ ..] = bytes {
        *value = value.wrapping_mul(10).wrapping_add(u64::from(digit - b'0'));
        bytes = rest;
    }
    bytes
}

/// `-?digits`, for a float `-?digits(.digits)?`, at the start of `bytes`, and what follows it.
/// Only up to 15 digits: a double holds those exactly, and the power of ten too, so the division
/// rounds once and gives what `parse_f64` gives.
fn plain_number(bytes: &[u8], is_float: bool) -> Option<(JSValue, &[u8])> {
    const POWERS_OF_TEN: [f64; 16] = [
        1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15,
    ];
    let (negative, unsigned) = match bytes {
        [b'-', rest @ ..] => (true, rest),
        _ => (false, bytes),
    };
    let mut value = 0;
    let mut rest = digits(unsigned, &mut value);
    let mut count = unsigned.len() - rest.len();
    let mut fraction = 0;
    if count == 0 {
        return None;
    }
    if is_float && let [b'.', after @ ..] = rest {
        rest = digits(after, &mut value);
        fraction = after.len() - rest.len();
        if fraction == 0 {
            return None;
        }
        count += fraction;
    }
    if count > 15 {
        return None;
    }
    let value = value as i64;
    let number = if is_float {
        let value = value as f64 / POWERS_OF_TEN[fraction];
        JSValue::js_double_number(if negative { -value } else { value })
    } else {
        JSValue::js_number_from_int32(i32::try_from(if negative { -value } else { value }).ok()?)
    };
    Some((number, rest))
}

/// Parses what the server's `array_out` prints.
struct ArrayParser<'a> {
    rest: &'a [u8],
    element: types::Tag,
    delimiter: u8,
    bigint: bool,
    global_object: &'a JSGlobalObject,
    unescaped: Vec<u8>,
}

impl<'a> ArrayParser<'a> {
    fn level(&mut self, depth: usize) -> Result<SQLDataCell> {
        use types::Tag as T;
        if depth > MAX_ARRAY_DIMENSIONS || self.next_byte()? != b'{' {
            return Err(AnyPostgresError::UnsupportedArrayFormat);
        }
        let mut cells = ArrayCells(Vec::new());
        match (self.rest.first(), self.element) {
            (Some(b'}'), _) => {
                self.rest = &self.rest[1..];
                return cells.into_cell();
            }
            (Some(b'{'), _) => {}
            (_, T::int2 | T::int4) => return self.numbers(false),
            (_, T::float4 | T::float8) => return self.numbers(true),
            _ => {}
        }
        loop {
            let cell = match self.rest.first() {
                Some(b'{') => self.level(depth + 1)?,
                Some(b'"') => self.quoted()?,
                _ => self.bare()?,
            };
            cells.0.push(cell);
            match self.next_byte()? {
                b'}' => return cells.into_cell(),
                byte if byte == self.delimiter => {}
                _ => return Err(AnyPostgresError::UnsupportedArrayFormat),
            }
        }
    }

    /// The rest of a level of numbers and NULLs, which need no cell each.
    fn numbers(&mut self, is_float: bool) -> Result<SQLDataCell> {
        use bun_core::fmt::{parse_decimal, parse_f64};
        let mut values: Vec<JSValue> = Vec::new();
        loop {
            values.push(match plain_number(self.rest, is_float) {
                Some((number, rest @ [end, ..])) if *end == self.delimiter || *end == b'}' => {
                    self.rest = rest;
                    number
                }
                _ => match self.bare_text()? {
                    b"NULL" => JSValue::NULL,
                    text if is_float => JSValue::js_double_number(JSValue::purify_nan(
                        parse_f64(text).ok_or(AnyPostgresError::InvalidCharacter)?,
                    )),
                    text => JSValue::js_number_from_int32(
                        parse_decimal(text).ok_or(AnyPostgresError::InvalidCharacter)?,
                    ),
                },
            });
            if self.next_byte()? == b'}' {
                break;
            }
        }
        if values.capacity() > u32::MAX as usize {
            return Err(AnyPostgresError::UnsupportedArrayFormat);
        }
        Ok(SQLDataCell::numbers(values))
    }

    fn next_byte(&mut self) -> Result<u8> {
        let (&byte, rest) = self
            .rest
            .split_first()
            .ok_or(AnyPostgresError::UnsupportedArrayFormat)?;
        self.rest = rest;
        Ok(byte)
    }

    /// Inside the quotes a backslash takes the next byte as it is.
    fn quoted(&mut self) -> Result<SQLDataCell> {
        let mut rest: &'a [u8] = &self.rest[1..];
        self.unescaped.clear();
        loop {
            let special = strings::index_of_any(rest, b"\"\\")
                .ok_or(AnyPostgresError::UnsupportedArrayFormat)?;
            let (plain, tail) = rest.split_at(special);
            if tail[0] == b'"' {
                self.rest = &tail[1..];
                let text = if self.unescaped.is_empty() {
                    plain
                } else {
                    self.unescaped.extend_from_slice(plain);
                    self.unescaped.as_slice()
                };
                return from_text(self.bigint, self.element, text, self.global_object);
            }
            let escaped = *tail
                .get(1)
                .ok_or(AnyPostgresError::UnsupportedArrayFormat)?;
            self.unescaped.extend_from_slice(plain);
            self.unescaped.push(escaped);
            rest = &tail[2..];
        }
    }

    fn bare(&mut self) -> Result<SQLDataCell> {
        match self.bare_text()? {
            b"NULL" => Ok(SQLDataCell::null()),
            text => from_text(self.bigint, self.element, text, self.global_object),
        }
    }

    /// Up to the delimiter or the brace that ends the element.
    fn bare_text(&mut self) -> Result<&'a [u8]> {
        let end = strings::index_of_any(self.rest, &[self.delimiter, b'}'])
            .filter(|&end| end > 0)
            .ok_or(AnyPostgresError::UnsupportedArrayFormat)?;
        let (text, rest) = self.rest.split_at(end);
        self.rest = rest;
        Ok(text)
    }
}

fn parse_array(
    bytes: &[u8],
    array: types::Tag,
    element: types::Tag,
    bigint: bool,
    global_object: &JSGlobalObject,
) -> Result<SQLDataCell> {
    // `[0:2]={1,2,3}`: only the whole value has bounds, and JS arrays start at 0.
    let rest = if bytes.first() == Some(&b'[') {
        let equals = strings::index_of_char_usize(bytes, b'=')
            .ok_or(AnyPostgresError::UnsupportedArrayFormat)?;
        &bytes[equals + 1..]
    } else {
        bytes
    };
    let mut parser = ArrayParser {
        rest,
        element,
        delimiter: array.array_delimiter(),
        bigint,
        global_object,
        unescaped: Vec::new(),
    };
    let mut cell = parser.level(1)?;
    if !parser.rest.is_empty() {
        cell.deinit();
        return Err(AnyPostgresError::UnsupportedArrayFormat);
    }
    Ok(cell)
}

fn take<const SIZE: usize>(rest: &mut &[u8]) -> Result<[u8; SIZE]> {
    let (head, tail) = rest
        .split_first_chunk::<SIZE>()
        .ok_or(AnyPostgresError::InvalidBinaryData)?;
    *rest = tail;
    Ok(*head)
}

fn double(value: f64) -> JSValue {
    JSValue::js_double_number(JSValue::purify_nan(value))
}

/// `length` elements: 4 bytes of size, -1 for a NULL, and the value.
fn binary_numbers<const SIZE: usize>(
    length: usize,
    rest: &mut &[u8],
    decode: impl Fn([u8; SIZE]) -> JSValue,
) -> Result<SQLDataCell> {
    let mut values: Vec<JSValue> = Vec::with_capacity(length);
    for _ in 0..length {
        let size = i32::from_be_bytes(take(rest)?);
        values.push(if size == SIZE as i32 {
            decode(take(rest)?)
        } else if size == -1 {
            JSValue::NULL
        } else {
            return Err(AnyPostgresError::InvalidBinaryData);
        });
    }
    Ok(SQLDataCell::numbers(values))
}

fn binary_level(element: types::Tag, lengths: &[usize], rest: &mut &[u8]) -> Result<SQLDataCell> {
    use types::Tag as T;
    let [length, inner @ ..] = lengths else {
        return ArrayCells(Vec::new()).into_cell();
    };
    // An element takes 4 bytes or more: a length that the message cannot hold reserves nothing.
    if *length > rest.len() / 4 {
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    if !inner.is_empty() {
        let mut cells = ArrayCells(Vec::with_capacity(*length));
        for _ in 0..*length {
            cells.0.push(binary_level(element, inner, rest)?);
        }
        return cells.into_cell();
    }
    match element {
        T::int2 => binary_numbers(*length, rest, |bytes| {
            JSValue::js_number_from_int32(i16::from_be_bytes(bytes).into())
        }),
        T::int4 => binary_numbers(*length, rest, |bytes| {
            JSValue::js_number_from_int32(i32::from_be_bytes(bytes))
        }),
        T::float4 => binary_numbers(*length, rest, |bytes| {
            double(f32::from_be_bytes(bytes).into())
        }),
        T::float8 => binary_numbers(*length, rest, |bytes| double(f64::from_be_bytes(bytes))),
        _ => Err(AnyPostgresError::UnknownFormatCode),
    }
}

/// What the server's `array_send` writes.
fn binary_array(element: types::Tag, mut rest: &[u8]) -> Result<SQLDataCell> {
    let dimensions = u32::from_be_bytes(take(&mut rest)?) as usize;
    // Set also for an array that had a NULL once.
    let _has_nulls: [u8; 4] = take(&mut rest)?;
    let oid = u32::from_be_bytes(take(&mut rest)?);
    if dimensions > MAX_ARRAY_DIMENSIONS || types::Tag::from_oid(oid) != element {
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    let mut lengths = [0usize; MAX_ARRAY_DIMENSIONS];
    for length in &mut lengths[..dimensions] {
        // An array without elements has no dimensions.
        *length = usize::try_from(i32::from_be_bytes(take(&mut rest)?))
            .ok()
            .filter(|&length| length > 0)
            .ok_or(AnyPostgresError::InvalidBinaryData)?;
        // JS arrays start at 0.
        let _lower_bound: [u8; 4] = take(&mut rest)?;
    }
    // A typed array has one dimension and no place for a NULL.
    let typed = match element {
        types::Tag::int4 => Some(Tag::Int32Array),
        types::Tag::float4 => Some(Tag::Float32Array),
        _ => None,
    };
    if let Some(tag) = typed
        && dimensions <= 1
        && let (elements, []) = rest.as_chunks::<8>()
        && elements.len() == lengths[0]
        && elements.iter().all(|wire| wire[..4] == [0, 0, 0, 4])
    {
        return Ok(SQLDataCell::typed_array(tag, elements));
    }
    let mut cell = binary_level(element, &lengths[..dimensions], &mut rest)?;
    if !rest.is_empty() {
        cell.deinit();
        return Err(AnyPostgresError::InvalidBinaryData);
    }
    Ok(cell)
}

/// `ResultFormats::Decodable`, plus the types whose binary form is their text.
fn from_binary(tag: types::Tag, bytes: &[u8]) -> Result<SQLDataCell> {
    use types::Tag as T;
    match tag {
        T::int2_array => binary_array(T::int2, bytes),
        T::int4_array => binary_array(T::int4, bytes),
        T::float4_array => binary_array(T::float4, bytes),
        T::float8_array => binary_array(T::float8, bytes),
        T::bool => Ok(SQLDataCell::bool(bytes.first() == Some(&1))),
        T::int4 => {
            let bytes: [u8; 4] = bytes
                .try_into()
                .map_err(|_| AnyPostgresError::UnsupportedIntegerSize)?;
            Ok(SQLDataCell::int4(i32::from_be_bytes(bytes)))
        }
        T::float4 => {
            let bytes: [u8; 4] = bytes
                .try_into()
                .map_err(|_| AnyPostgresError::InvalidBinaryData)?;
            Ok(SQLDataCell::float8(f32::from_be_bytes(bytes).into()))
        }
        T::float8 => {
            let bytes: [u8; 8] = bytes
                .try_into()
                .map_err(|_| AnyPostgresError::InvalidBinaryData)?;
            Ok(SQLDataCell::float8(f64::from_be_bytes(bytes)))
        }
        T::timestamp | T::timestamptz => {
            if bytes.len() != 8 {
                return Err(AnyPostgresError::InvalidBinaryData);
            }
            Ok(SQLDataCell::date(
                crate::postgres::types::date::from_binary(bytes),
            ))
        }
        T::bytea => Ok(SQLDataCell {
            tag: Tag::Bytea,
            value: Value {
                bytea: [bytes.as_ptr() as usize, bytes.len()],
            },
            ..Default::default()
        }),
        T::text | T::varchar | T::bpchar | T::name | T::char => Ok(SQLDataCell::string(bytes)),
        T::json => Ok(SQLDataCell::json(bytes)),
        _ => Err(AnyPostgresError::UnknownFormatCode),
    }
}

fn from_text(
    bigint: bool,
    tag: types::Tag,
    bytes: &[u8],
    global_object: &JSGlobalObject,
) -> Result<SQLDataCell> {
    use bun_core::fmt::{parse_decimal, parse_f64};
    use types::Tag as T;
    match tag {
        T::int2 | T::int4 => Ok(SQLDataCell::int4(
            parse_decimal::<i32>(bytes).ok_or(AnyPostgresError::InvalidCharacter)?,
        )),
        T::cid | T::xid | T::oid => Ok(SQLDataCell::uint4(
            parse_decimal::<u32>(bytes).ok_or(AnyPostgresError::InvalidCharacter)?,
        )),
        T::int8 if bigint => Ok(SQLDataCell::int8(
            parse_decimal::<i64>(bytes).ok_or(AnyPostgresError::InvalidCharacter)?,
        )),
        T::float4 | T::float8 => Ok(SQLDataCell::float8(
            parse_f64(bytes).ok_or(AnyPostgresError::InvalidCharacter)?,
        )),
        T::jsonb | T::json => Ok(SQLDataCell::json(bytes)),
        T::bool => Ok(SQLDataCell::bool(bytes.first() == Some(&b't'))),
        T::date | T::timestamp | T::timestamptz => {
            if bytes.is_empty() {
                return Ok(SQLDataCell::null());
            }
            Ok(SQLDataCell::date(parse_date_time_text(
                bytes,
                global_object,
            )))
        }
        T::bytea => parse_bytea(
            bytes
                .strip_prefix(b"\\x")
                .ok_or(AnyPostgresError::UnsupportedByteaFormat)?,
        ),
        _ => match tag.array_element() {
            Some(element) => parse_array(bytes, tag, element, bigint, global_object),
            None => Ok(SQLDataCell::string(bytes)),
        },
    }
}

pub(crate) struct Putter<'a> {
    pub list: &'a mut [SQLDataCell],
    pub fields: &'a [protocol::FieldDescription],
    /// What Bind asked for; the `fields` of the Describe before it always say text.
    pub formats: types::ResultFormats,
    pub bigint: bool,
    pub global_object: &'a JSGlobalObject,
}

impl<'a> Putter<'a> {
    pub(crate) fn to_js(
        &mut self,
        array: JSValue,
        structure: JSValue,
        flags: Flags,
        result_mode: PostgresSQLQueryResultMode,
        cached_structure: Option<&PostgresCachedStructure>,
    ) -> Result<JSValue, AnyPostgresError> {
        SQLDataCell::to_js_object(
            self.global_object,
            array,
            structure,
            self.list,
            flags,
            result_mode as u8,
            cached_structure,
        )
        .map_err(crate::jsc::js_error_to_postgres)
    }

    fn put_impl<const IS_RAW: bool>(
        &mut self,
        index: u32,
        optional_bytes: Option<&mut Data>,
    ) -> Result<bool> {
        // Bounds check to prevent crash when fields/list arrays are empty
        if (index as usize) >= self.fields.len() {
            bun_core::scoped_log!(
                Postgres,
                "putImpl: index {} >= fields.len {}, ignoring extra field",
                index,
                self.fields.len()
            );
            return Ok(false);
        }
        if (index as usize) >= self.list.len() {
            bun_core::scoped_log!(
                Postgres,
                "putImpl: index {} >= list.len {}, ignoring extra field",
                index,
                self.list.len()
            );
            return Ok(false);
        }

        let field = &self.fields[index as usize];
        bun_core::scoped_log!(Postgres, "index: {}, oid: {}", index, field.type_oid);
        let cell: &mut SQLDataCell = &mut self.list[index as usize];
        if IS_RAW {
            *cell = SQLDataCell::raw(optional_bytes);
        } else {
            let tag = types::Tag::from_oid(field.type_oid);
            *cell = match optional_bytes {
                None => SQLDataCell::null(),
                Some(data) if field.binary || tag.is_binary_in(self.formats) => {
                    from_binary(tag, data.slice())?
                }
                Some(data) => from_text(self.bigint, tag, data.slice(), self.global_object)?,
            };
        }
        // TODO: when duplicate and we know the result will be an object
        // and not a .values() array, we can discard the data
        // immediately.
        cell.set_column(index, &field.name_or_index);
        Ok(true)
    }

    pub(crate) fn put_raw(
        &mut self,
        index: u32,
        optional_bytes: Option<&mut Data>,
    ) -> Result<bool> {
        self.put_impl::<true>(index, optional_bytes)
    }

    pub(crate) fn put(&mut self, index: u32, optional_bytes: Option<&mut Data>) -> Result<bool> {
        self.put_impl::<false>(index, optional_bytes)
    }
}
