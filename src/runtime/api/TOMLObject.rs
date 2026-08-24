use bun_collections::HashMap;
use bun_core::StackCheck;
use bun_core::String as BunString;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult, MarkedArgumentBuffer,
    TemporalType, wtf,
};
use bun_parsers::toml::TOML;

use super::stringify_replacer::{Properties, Replacer};

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("parse", __jsc_host_parse, 1),
            ("stringify", __jsc_host_stringify, 3),
        ],
    )
}

#[bun_jsc::host_fn]
pub(crate) fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.toml",
        super::BlobOrBufferInput::Bytes,
        super::NullishInput::Throw,
        |arena, log, source| {
            let root = match TOML::parse(source, log, arena, false) {
                Ok(v) => v,
                Err(bun_parsers::Error::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(bun_parsers::Error::Alloc(_)) => {
                    return Err(JsError::OutOfMemory);
                }
                Err(_) => {
                    if let Some(first_msg) = log.msgs.first() {
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "TOML Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("TOML Parse error: Unable to parse TOML"),
                    )));
                }
            };

            super::expr_to_js(root, global)
        },
    )
}

#[bun_jsc::host_fn]
fn stringify(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // `space` is accepted for signature parity with YAML/JSON5 but ignored:
    // TOML output is line-oriented and has no nesting indentation.
    let [value, replacer, _space] = frame.arguments_as_array::<3>();

    let replacer = Replacer::from_js(global, replacer)?;
    let value = match &replacer {
        Some(replacer) => replacer.replace_root(global, value)?,
        None => value,
    };

    value.ensure_still_alive();

    if value.is_undefined() || value.is_symbol() || value.is_function() {
        return Ok(JSValue::UNDEFINED);
    }

    let unwrapped = value.unwrap_boxed_primitive(global)?;
    if !unwrapped.is_object() || unwrapped.is_array() || is_date_time(unwrapped) {
        return Err(global.throw(format_args!(
            "TOML.stringify expects an object at the top level (a TOML document is a table)"
        )));
    }

    MarkedArgumentBuffer::new(|roots| {
        let mut stringifier = Stringifier {
            stack_check: StackCheck::init(),
            builder: wtf::StringBuilder::init(),
            visiting: HashMap::default(),
            wrote: false,
            replacer,
            roots,
        };

        if let Err(err) = stringifier.stringify_root(global, unwrapped) {
            return match err {
                StringifyError::Js(js_err) => Err(js_err),
                StringifyError::StackOverflow => Err(global.throw_stack_overflow()),
            };
        }

        stringifier.builder.to_string(global)
    })
}

#[derive(Debug)]
enum StringifyError {
    Js(JsError),
    StackOverflow,
}

impl From<JsError> for StringifyError {
    fn from(e: JsError) -> Self {
        StringifyError::Js(e)
    }
}

type StringifyResult<T> = Result<T, StringifyError>;

/// Largest integer a JS number represents exactly; larger integral values
/// must be emitted as TOML floats so they round-trip through any reader.
const MAX_SAFE_INTEGER_F: f64 = 9007199254740991.0;

/// A value read once, through the replacer, in the order `JSON.stringify` reads it.
enum Value {
    /// A boolean, number, string, `Date` or Temporal object, or a `BigInt` (rejected when written).
    Scalar(JSValue),
    Array(Vec<Value>),
    Table(Vec<Entry>),
}

struct Entry {
    name: BunString,
    value: Value,
}

/// Whether an array is written as `[[key]]` sections: non-empty, and every element a table.
fn is_array_of_tables(items: &[Value]) -> bool {
    !items.is_empty() && items.iter().all(|item| matches!(item, Value::Table(_)))
}

/// Reads the document once into `Value`s, then writes them.
struct Stringifier<'a> {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    // NOTE: `JSValue` keys live on the heap here, but every entry is also
    // live on the native stack via the `read` recursion chain, so the
    // conservative GC scan keeps them alive.
    visiting: HashMap<JSValue, ()>,
    /// Whether any line has been written (controls blank lines before headers).
    wrote: bool,
    replacer: Option<Replacer>,
    /// Keeps every `Value::Scalar` alive while a replacer or getter runs JS.
    roots: &'a mut MarkedArgumentBuffer,
}

/// Header path of the table being written: a parent-linked chain of `Entry` names on the write stack.
struct Path<'p> {
    parent: Option<&'p Path<'p>>,
    key: &'p BunString,
}

impl Stringifier<'_> {
    fn replace_property(
        &self,
        global: &JSGlobalObject,
        holder: JSValue,
        name: &BunString,
        value: JSValue,
    ) -> JsResult<JSValue> {
        match &self.replacer {
            Some(replacer) => replacer.replace_property(global, holder, name, value),
            None => Ok(value),
        }
    }

    fn replace_element(
        &self,
        global: &JSGlobalObject,
        array: JSValue,
        index: u32,
        value: JSValue,
    ) -> JsResult<JSValue> {
        match &self.replacer {
            Some(replacer) => replacer.replace_element(global, array, index, value),
            None => Ok(value),
        }
    }

    fn stringify_root(&mut self, global: &JSGlobalObject, root: JSValue) -> StringifyResult<()> {
        let entries = self.read_table(global, root)?;
        self.write_table(global, &entries, None, false)
    }

    fn mark_visiting(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyResult<()> {
        let was_present = self
            .visiting
            .get_or_put(value)
            .map_err(|_| StringifyError::Js(JsError::OutOfMemory))?
            .found_existing;
        if was_present {
            return Err(global
                .throw(format_args!("Converting circular structure to TOML"))
                .into());
        }
        Ok(())
    }

    /// Reads one (already unboxed) value that a table or an array holds.
    fn read(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyResult<Value> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }
        if value.is_array() {
            self.mark_visiting(global, value)?;
            let mut iter = value.array_iterator(global)?;
            let mut items: Vec<Value> = Vec::new();
            let mut index: u32 = 0;
            while let Some(item) = iter.next()? {
                let item = self.replace_element(global, value, index, item)?;
                index += 1;
                let item = item.unwrap_boxed_primitive(global)?;
                if item.is_null() || item.is_undefined() || item.is_symbol() || item.is_function() {
                    return Err(self.err_in_array(global, item));
                }
                items.push(self.read(global, item)?);
            }
            self.visiting.remove(&value);
            return Ok(Value::Array(items));
        }
        if value.is_object() && !value.is_function() && !is_date_time(value) {
            return Ok(Value::Table(self.read_table(global, value)?));
        }
        self.roots.append(value);
        Ok(Value::Scalar(value))
    }

    /// Reads the properties of a table. `undefined`, function and symbol values are left out.
    fn read_table(
        &mut self,
        global: &JSGlobalObject,
        table: JSValue,
    ) -> StringifyResult<Vec<Entry>> {
        self.mark_visiting(global, table)?;
        let mut properties = Properties::init(global, table, self.replacer.as_ref())?;
        let mut entries: Vec<Entry> = Vec::with_capacity(properties.len());
        while let Some((name, value)) = properties.next()? {
            let value = self.replace_property(global, table, &name, value)?;
            let value = value.unwrap_boxed_primitive(global)?;
            if value.is_undefined() || value.is_symbol() || value.is_function() {
                continue;
            }
            if value.is_null() {
                return Err(self.err_null_value(global, &name));
            }
            let value = self.read(global, value)?;
            entries.push(Entry {
                name: (*name).clone(),
                value,
            });
        }
        self.visiting.remove(&table);
        Ok(entries)
    }

    /// Writes the body of one table: `key = value` lines first, then
    /// `[sub.table]` and `[[array.of.tables]]` sections (a keyval after a
    /// header would belong to that header, so the order is forced).
    /// `own_header` defers `[path]`: a sub-section reached first implies it.
    fn write_table(
        &mut self,
        global: &JSGlobalObject,
        entries: &[Entry],
        path: Option<&Path<'_>>,
        own_header: bool,
    ) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }
        let mut header_pending = own_header;

        for entry in entries {
            match &entry.value {
                Value::Table(_) => continue,
                Value::Array(items) if is_array_of_tables(items) => continue,
                Value::Scalar(_) | Value::Array(_) => {}
            }
            if header_pending {
                header_pending = false;
                self.append_header(path, false);
            }
            self.append_key_segment(&entry.name);
            self.builder.append_latin1(b" = ");
            self.write_inline(global, &entry.value)?;
            self.builder.append_lchar(b'\n');
            self.wrote = true;
        }

        for entry in entries {
            match &entry.value {
                Value::Table(sub_entries) => {
                    header_pending = false;
                    let child = Path {
                        parent: path,
                        key: &entry.name,
                    };
                    self.write_table(global, sub_entries, Some(&child), true)?;
                }
                Value::Array(items) if is_array_of_tables(items) => {
                    header_pending = false;
                    let child = Path {
                        parent: path,
                        key: &entry.name,
                    };
                    for item in items {
                        let Value::Table(item_entries) = item else {
                            unreachable!("is_array_of_tables checked every element");
                        };
                        self.append_header(Some(&child), true);
                        self.write_table(global, item_entries, Some(&child), false)?;
                    }
                }
                Value::Scalar(_) | Value::Array(_) => {}
            }
        }

        // An empty table is materialized only by its header.
        if header_pending {
            self.append_header(path, false);
        }

        Ok(())
    }

    /// One value on the right-hand side of `=`, or inside an inline array or table.
    fn write_inline(&mut self, global: &JSGlobalObject, value: &Value) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }

        let scalar = match value {
            Value::Scalar(scalar) => *scalar,
            Value::Array(items) => {
                self.builder.append_lchar(b'[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        self.builder.append_latin1(b", ");
                    }
                    self.write_inline(global, item)?;
                }
                self.builder.append_lchar(b']');
                return Ok(());
            }
            Value::Table(entries) => {
                // A table inside an inline value becomes an inline table.
                if entries.is_empty() {
                    self.builder.append_latin1(b"{}");
                    return Ok(());
                }
                for (i, entry) in entries.iter().enumerate() {
                    self.builder
                        .append_latin1(if i == 0 { b"{ " } else { b", " });
                    self.append_key_segment(&entry.name);
                    self.builder.append_latin1(b" = ");
                    self.write_inline(global, &entry.value)?;
                }
                self.builder.append_latin1(b" }");
                return Ok(());
            }
        };

        if scalar.is_boolean() {
            self.builder.append_latin1(if scalar.as_boolean() {
                b"true"
            } else {
                b"false"
            });
            return Ok(());
        }

        if scalar.is_number() {
            self.append_number(scalar);
            return Ok(());
        }

        if scalar.is_big_int() {
            return Err(global
                .throw(format_args!("TOML.stringify cannot serialize BigInt"))
                .into());
        }

        if scalar.is_string() {
            let str = scalar.to_bun_string(global)?;
            self.append_basic_quoted(&str);
            return Ok(());
        }

        if scalar.is_date() {
            return self.append_datetime(global, scalar);
        }

        if let Some(temporal_type) = temporal_object_type(scalar) {
            return self.append_temporal(global, scalar, temporal_type);
        }

        // `read` only lets `null`, `undefined`, a symbol or a function through as an array element.
        Err(self.err_in_array(global, scalar))
    }

    // ── output pieces ──────────────────────────────────────────────────────

    /// `[a.b.c]` or `[[a.b.c]]` from `path`, after a blank line when the document has content.
    fn append_header(&mut self, path: Option<&Path<'_>>, array_of_tables: bool) {
        if self.wrote {
            self.builder.append_lchar(b'\n');
        }
        self.builder
            .append_latin1(if array_of_tables { b"[[" } else { b"[" });
        if let Some(path) = path {
            self.append_path(path);
        }
        self.builder
            .append_latin1(if array_of_tables { b"]]\n" } else { b"]\n" });
        self.wrote = true;
    }

    fn append_path(&mut self, path: &Path<'_>) {
        if let Some(parent) = path.parent {
            self.append_path(parent);
            self.builder.append_lchar(b'.');
        }
        self.append_key_segment(path.key);
    }

    fn append_key_segment(&mut self, name: &BunString) {
        if is_bare_key(name) {
            self.builder.append_string(name);
        } else {
            append_basic_quoted_to(&mut self.builder, name);
        }
    }

    fn append_basic_quoted(&mut self, str: &BunString) {
        append_basic_quoted_to(&mut self.builder, str);
    }

    fn append_number(&mut self, value: JSValue) {
        if value.is_int32() {
            self.builder.append_int(value.as_int32());
            return;
        }
        let num = value.as_number();
        if num.is_nan() {
            self.builder.append_latin1(b"nan");
            return;
        }
        if num.is_infinite() {
            self.builder
                .append_latin1(if num < 0.0 { b"-inf" } else { b"inf" });
            return;
        }
        if num == 0.0 {
            // A double-encoded zero (is_int32 is an encoding check, not a
            // value check); only the negative sign needs float form.
            self.builder.append_latin1(if num.is_sign_negative() {
                b"-0.0"
            } else {
                b"0"
            });
            return;
        }
        self.builder.append_double(num);
        // Integral doubles beyond the safe range print as bare digits, which
        // a TOML reader would treat as an (out-of-range) integer; mark them
        // as floats. At 1e21 and above the repr already has an exponent.
        if num.fract() == 0.0 && num.abs() > MAX_SAFE_INTEGER_F && num.abs() < 1e21 {
            self.builder.append_latin1(b".0");
        }
    }

    /// A JS Date as a TOML offset date-time (`1979-05-27T07:32:00.999Z`).
    /// A TOML offset date-time is RFC 3339, which the 24-byte
    /// `YYYY-MM-DDTHH:mm:ss.sssZ` form of `Date.prototype.toISOString` is.
    fn append_datetime(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyResult<()> {
        let mut buf = [0u8; 64];
        let Some(iso) = value.to_iso_string(global, &mut buf) else {
            return Err(global
                .throw(format_args!(
                    "TOML.stringify cannot serialize an invalid Date"
                ))
                .into());
        };
        // The expanded-year form (leading `+`/`-`) has a 6-digit year, which
        // TOML's 4-digit `date-fullyear` cannot carry.
        if !iso[0].is_ascii_digit() {
            return Err(global
                .throw(format_args!(
                    "TOML.stringify cannot serialize a Date outside years 0000-9999"
                ))
                .into());
        }
        // `toISOString` always prints three fraction digits; trim trailing
        // zeros (and a bare `.`) so `Date` and `Temporal.Instant` spell the
        // same instant identically.
        debug_assert!(iso.len() == 24 && iso[19] == b'.' && iso[23] == b'Z');
        let mut end = 23;
        while end > 20 && iso[end - 1] == b'0' {
            end -= 1;
        }
        if end == 20 {
            end = 19;
        }
        self.builder.append_latin1(&iso[..end]);
        self.builder.append_lchar(b'Z');
        Ok(())
    }

    /// A Temporal object as the TOML date/time literal of its type;
    /// `PlainYearMonth`/`PlainMonthDay`/`Duration` have no TOML form and throw.
    fn append_temporal(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
        temporal_type: TemporalType,
    ) -> StringifyResult<()> {
        if !has_toml_form(temporal_type) {
            return Err(global
                .throw(format_args!(
                    "TOML.stringify cannot serialize {} (it has no TOML representation)",
                    temporal_name(temporal_type)
                ))
                .into());
        }
        let mut buf = [0u8; 64];
        // SAFETY: `buf` is a live stack buffer for the duration of the call.
        let len = unsafe {
            jsc::cpp::Bun__Temporal__toTOMLDateTime(
                global,
                value,
                temporal_type,
                buf.as_mut_ptr(),
                buf.len(),
            )
        }?;
        if len < 0 {
            return Err(global
                .throw(format_args!(
                    "TOML.stringify cannot serialize a {} outside years 0000-9999",
                    temporal_name(temporal_type)
                ))
                .into());
        }
        self.builder.append_latin1(&buf[..len as usize]);
        Ok(())
    }

    // ── errors ─────────────────────────────────────────────────────────────

    fn err_null_value(&mut self, global: &JSGlobalObject, key: &BunString) -> StringifyError {
        global
            .throw(format_args!(
                "TOML cannot represent null (key '{key}'); remove the key or use a sentinel value",
            ))
            .into()
    }

    fn err_in_array(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyError {
        let what: &str = if value.is_null() {
            "null"
        } else if value.is_undefined() {
            "undefined"
        } else if value.is_symbol() {
            "a symbol"
        } else {
            "a function"
        };
        global
            .throw(format_args!("TOML cannot represent {} in an array", what))
            .into()
    }
}

fn temporal_object_type(value: JSValue) -> Option<TemporalType> {
    match value.temporal_type() {
        TemporalType::None => None,
        t => Some(t),
    }
}

/// The objects written as one date/time value rather than as a table.
fn is_date_time(value: JSValue) -> bool {
    value.is_date() || temporal_object_type(value).is_some()
}

/// Whether TOML has a date/time literal for this type.
fn has_toml_form(t: TemporalType) -> bool {
    match t {
        TemporalType::Instant
        | TemporalType::PlainDateTime
        | TemporalType::PlainDate
        | TemporalType::PlainTime
        | TemporalType::ZonedDateTime => true,
        TemporalType::None
        | TemporalType::PlainYearMonth
        | TemporalType::PlainMonthDay
        | TemporalType::Duration => false,
    }
}

fn temporal_name(t: TemporalType) -> &'static str {
    match t {
        TemporalType::Instant => "Temporal.Instant",
        TemporalType::PlainDateTime => "Temporal.PlainDateTime",
        TemporalType::PlainDate => "Temporal.PlainDate",
        TemporalType::PlainTime => "Temporal.PlainTime",
        TemporalType::ZonedDateTime => "Temporal.ZonedDateTime",
        TemporalType::PlainYearMonth => "Temporal.PlainYearMonth",
        TemporalType::PlainMonthDay => "Temporal.PlainMonthDay",
        TemporalType::Duration => "Temporal.Duration",
        TemporalType::None => unreachable!("not a Temporal object"),
    }
}

fn is_bare_key(name: &BunString) -> bool {
    if name.length() == 0 {
        return false;
    }
    for i in 0..name.length() {
        let c = name.char_at(i);
        let ok = c < 0x80 && {
            let b = c as u8;
            b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
        };
        if !ok {
            return false;
        }
    }
    true
}

/// TOML basic string with escapes. Unpaired surrogates become U+FFFD, the
/// same USVString conversion `TOML.parse` applies to its string input.
fn append_basic_quoted_to(builder: &mut wtf::StringBuilder, str: &BunString) {
    builder.append_lchar(b'"');
    let len = str.length();
    let mut i = 0;
    while i < len {
        let c = str.char_at(i);
        match c {
            0x08 => builder.append_latin1(b"\\b"),
            0x09 => builder.append_latin1(b"\\t"),
            0x0a => builder.append_latin1(b"\\n"),
            0x0c => builder.append_latin1(b"\\f"),
            0x0d => builder.append_latin1(b"\\r"),
            0x22 => builder.append_latin1(b"\\\""),
            0x5c => builder.append_latin1(b"\\\\"),
            0x00..=0x1f | 0x7f => {
                builder.append_latin1(b"\\u00");
                builder.append_lchar(bun_core::fmt::hex_char_lower((c >> 4) as u8));
                builder.append_lchar(bun_core::fmt::hex_char_lower(c as u8));
            }
            0xD800..=0xDBFF => {
                if i + 1 < len && (0xDC00..=0xDFFF).contains(&str.char_at(i + 1)) {
                    builder.append_uchar(c);
                    builder.append_uchar(str.char_at(i + 1));
                    i += 1;
                } else {
                    builder.append_uchar(0xFFFD);
                }
            }
            0xDC00..=0xDFFF => builder.append_uchar(0xFFFD),
            _ => builder.append_uchar(c),
        }
        i += 1;
    }
    builder.append_lchar(b'"');
}
