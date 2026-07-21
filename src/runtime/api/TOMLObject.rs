use bun_collections::HashMap;
use bun_core::StackCheck;
use bun_core::{OwnedString, String as BunString};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult, Local, Scope, wtf,
};
use bun_parsers::toml::TOML;

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("parse", __jsc_host_parse, 1),
            ("stringify", __jsc_host_stringify, 3),
        ],
    )
}

#[bun_jsc::host_fn(scoped)]
pub fn parse<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    let v = super::with_text_format_source(
        global,
        frame,
        b"input.toml",
        true,
        true,
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
    )?;
    Ok(scope.local(v))
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn stringify<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    // `space` is accepted for signature parity with YAML/JSON5 but ignored:
    // TOML output is line-oriented and has no nesting indentation.
    let [value, replacer, _space] = frame.scoped_arguments::<3>(scope).ptr;

    value.ensure_still_alive();

    if value.is_undefined() || value.is_symbol() || value.is_function() {
        return Ok(scope.undefined());
    }

    if !replacer.is_undefined_or_null() {
        return Err(scope.throw(format_args!(
            "TOML.stringify does not support the replacer argument"
        )));
    }

    let unwrapped = value.unscoped().unwrap_boxed_primitive(global)?;
    if !unwrapped.is_object() || unwrapped.is_array() || unwrapped.is_date() {
        return Err(scope.throw(format_args!(
            "TOML.stringify expects an object at the top level (a TOML document is a table)"
        )));
    }

    let mut stringifier = Stringifier {
        stack_check: StackCheck::init(),
        builder: wtf::StringBuilder::init(),
        visiting: HashMap::default(),
        path: Vec::new(),
        wrote: false,
    };

    if let Err(err) = stringifier.stringify_root(global, unwrapped) {
        return match err {
            StringifyError::Js(js_err) => Err(js_err),
            StringifyError::StackOverflow => Err(global.throw_stack_overflow()),
        };
    }

    let v = stringifier.builder.to_string(global)?;
    Ok(scope.local(v))
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

/// How a property value is laid out in the document.
enum Layout {
    /// `key = value` on the current table's line block.
    Keyval,
    /// `[path.key]` section.
    Table,
    /// `[[path.key]]` section per element.
    ArrayOfTables,
    Skip,
}

struct Stringifier {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    // NOTE: `JSValue` keys live on the heap here, but every entry is also
    // live on the native stack via the `stringify` recursion chain, so the
    // conservative GC scan keeps them alive.
    visiting: HashMap<JSValue, ()>,
    /// Header path of the table currently being emitted. Entries are
    /// borrowed, not ref-counted: each is pushed and popped within the one
    /// `JSPropertyIterator` loop body whose iterator keeps the name alive
    /// (the iterator's strings carry no extra reference).
    path: Vec<BunString>,
    /// Whether any line has been written (controls blank lines before headers).
    wrote: bool,
}

impl Stringifier {
    fn stringify_root(&mut self, global: &JSGlobalObject, root: JSValue) -> StringifyResult<()> {
        self.mark_visiting(global, root)?;
        self.stringify_table_body(global, root)?;
        self.visiting.remove(&root);
        Ok(())
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

    /// Decides the layout of one (already unboxed) property value. Reads
    /// array elements when classifying arrays.
    fn layout_of(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyResult<Layout> {
        if value.is_undefined() || value.is_symbol() || value.is_function() {
            return Ok(Layout::Skip);
        }
        if value.is_array() {
            // An array becomes [[key]] sections when it is non-empty and
            // every element is a plain object; otherwise it is inline.
            let mut iter = value.array_iterator(global)?;
            if iter.len == 0 {
                return Ok(Layout::Keyval);
            }
            while let Some(item) = iter.next()? {
                let item = item.unwrap_boxed_primitive(global)?;
                if !item.is_object() || item.is_array() || item.is_date() || item.is_function() {
                    return Ok(Layout::Keyval);
                }
            }
            return Ok(Layout::ArrayOfTables);
        }
        if value.is_object() && !value.is_date() {
            return Ok(Layout::Table);
        }
        Ok(Layout::Keyval)
    }

    /// Emits the body of one table: `key = value` lines first, then
    /// `[sub.table]` and `[[array.of.tables]]` sections (a keyval after a
    /// header would belong to that header, so the order is forced).
    fn stringify_table_body(
        &mut self,
        global: &JSGlobalObject,
        table: JSValue,
    ) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }

        let iter_options = jsc::JSPropertyIteratorOptions {
            skip_empty_name: false,
            include_value: true,
            ..Default::default()
        };

        // Pass 1: keyvals.
        let mut iter =
            jsc::JSPropertyIterator::init(global, table.to_object(global)?, iter_options)?;
        while let Some(prop_name) = iter.next()? {
            let value = iter.value.unwrap_boxed_primitive(global)?;
            if value.is_null() {
                return Err(self.err_null_value(global, &prop_name));
            }
            if let Layout::Keyval = self.layout_of(global, value)? {
                self.append_key_segment(&prop_name);
                self.builder.append_latin1(b" = ");
                self.stringify_inline_value(global, value)?;
                self.builder.append_lchar(b'\n');
                self.wrote = true;
            }
        }

        // Pass 2: sections. Values are re-read; an array-of-tables element
        // that is no longer a plain object during emission gets an error.
        let mut iter =
            jsc::JSPropertyIterator::init(global, table.to_object(global)?, iter_options)?;
        while let Some(prop_name) = iter.next()? {
            let value = iter.value.unwrap_boxed_primitive(global)?;
            match self.layout_of(global, value)? {
                Layout::Keyval | Layout::Skip => {}
                Layout::Table => {
                    self.mark_visiting(global, value)?;
                    self.path.push(prop_name);
                    self.append_header(false);
                    self.stringify_table_body(global, value)?;
                    self.path.pop();
                    self.visiting.remove(&value);
                }
                Layout::ArrayOfTables => {
                    self.mark_visiting(global, value)?;
                    self.path.push(prop_name);
                    let mut items = value.array_iterator(global)?;
                    while let Some(item) = items.next()? {
                        let item = item.unwrap_boxed_primitive(global)?;
                        if !item.is_object()
                            || item.is_array()
                            || item.is_date()
                            || item.is_function()
                        {
                            self.path.pop();
                            return Err(self.err_changed(global));
                        }
                        self.mark_visiting(global, item)?;
                        self.append_header(true);
                        self.stringify_table_body(global, item)?;
                        self.visiting.remove(&item);
                    }
                    self.path.pop();
                    self.visiting.remove(&value);
                }
            }
        }

        Ok(())
    }

    /// One value on the right-hand side of `=` (or inside an inline
    /// array/table). `value` is already unboxed.
    fn stringify_inline_value(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }

        if value.is_boolean() {
            self.builder.append_latin1(if value.as_boolean() {
                b"true"
            } else {
                b"false"
            });
            return Ok(());
        }

        if value.is_number() {
            self.append_number(value);
            return Ok(());
        }

        if value.is_big_int() {
            return Err(global
                .throw(format_args!("TOML.stringify cannot serialize BigInt"))
                .into());
        }

        if value.is_string() {
            let str = OwnedString::new(value.to_bun_string(global)?);
            self.append_basic_quoted(&str);
            return Ok(());
        }

        if value.is_date() {
            return self.append_datetime(global, value);
        }

        if value.is_array() {
            self.mark_visiting(global, value)?;
            self.builder.append_lchar(b'[');
            let mut iter = value.array_iterator(global)?;
            let mut first = true;
            while let Some(item) = iter.next()? {
                if !first {
                    self.builder.append_latin1(b", ");
                }
                first = false;
                let item = item.unwrap_boxed_primitive(global)?;
                if item.is_null() || item.is_undefined() || item.is_symbol() || item.is_function() {
                    return Err(self.err_in_array(global, item));
                }
                self.stringify_inline_value(global, item)?;
            }
            self.builder.append_lchar(b']');
            self.visiting.remove(&value);
            return Ok(());
        }

        // A plain object inside an inline context becomes an inline table.
        self.mark_visiting(global, value)?;
        let mut iter = jsc::JSPropertyIterator::init(
            global,
            value.to_object(global)?,
            jsc::JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;
        let mut first = true;
        while let Some(prop_name) = iter.next()? {
            let prop_value = iter.value.unwrap_boxed_primitive(global)?;
            if prop_value.is_undefined() || prop_value.is_symbol() || prop_value.is_function() {
                continue;
            }
            if prop_value.is_null() {
                return Err(self.err_null_value(global, &prop_name));
            }
            self.builder
                .append_latin1(if first { b"{ " } else { b", " });
            first = false;
            self.append_key_segment(&prop_name);
            self.builder.append_latin1(b" = ");
            self.stringify_inline_value(global, prop_value)?;
        }
        self.builder
            .append_latin1(if first { b"{}" } else { b" }" });
        self.visiting.remove(&value);
        Ok(())
    }

    // ── output pieces ──────────────────────────────────────────────────────

    /// `[a.b.c]` or `[[a.b.c]]` from `self.path`, preceded by a blank line
    /// when the document already has content.
    fn append_header(&mut self, array_of_tables: bool) {
        if self.wrote {
            self.builder.append_lchar(b'\n');
        }
        self.builder
            .append_latin1(if array_of_tables { b"[[" } else { b"[" });
        for (i, seg) in self.path.iter().enumerate() {
            if i > 0 {
                self.builder.append_lchar(b'.');
            }
            // Inlined `append_key_segment` to avoid borrowing `self.path`
            // across a `&mut self` call.
            if is_bare_key(seg) {
                self.builder.append_string(*seg);
            } else {
                append_basic_quoted_to(&mut self.builder, seg);
            }
        }
        self.builder
            .append_latin1(if array_of_tables { b"]]\n" } else { b"]\n" });
        self.wrote = true;
    }

    fn append_key_segment(&mut self, name: &BunString) {
        if is_bare_key(name) {
            self.builder.append_string(*name);
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
        self.builder.append_latin1(iso);
        Ok(())
    }

    // ── errors ─────────────────────────────────────────────────────────────

    fn err_null_value(&mut self, global: &JSGlobalObject, key: &BunString) -> StringifyError {
        let key_utf8 = key.to_utf8_bytes();
        global
            .throw(format_args!(
                "TOML cannot represent null (key '{}'); remove the key or use a sentinel value",
                bstr::BStr::new(&key_utf8)
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

    fn err_changed(&mut self, global: &JSGlobalObject) -> StringifyError {
        global
            .throw(format_args!(
                "TOML.stringify cannot serialize a value that changed during serialization"
            ))
            .into()
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
