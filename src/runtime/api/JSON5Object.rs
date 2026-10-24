use bun_collections::HashMap;
use bun_core::StackCheck;
use bun_core::String as BunString;
use bun_js_parser::lexer;
use bun_jsc::bindgen::{JsBytes, JsLocal, JsScope};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult, StringJsc, wtf};
use bun_parsers::json5;

pub(crate) fn stringify<'a>(
    cx: &mut JsScope<'a>,
    value: JsLocal<'a>,
    replacer: JsLocal<'a>,
    space: JsLocal<'a>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (value, replacer, space_value) = (value.to_js(), replacer.to_js(), space.to_js());

    let replacer = Replacer::init(global, replacer)?;
    let mut stringifier = Stringifier::init(global, &replacer, space_value)?;

    let holder = if matches!(replacer, Replacer::Function(_)) {
        let holder = JSValue::create_empty_object(global, 1);
        holder.put_may_be_index(global, &BunString::EMPTY, value)?;
        holder
    } else {
        JSValue::UNDEFINED
    };
    let value = stringifier.transform(global, holder, Key::Name(&BunString::EMPTY), value)?;

    if is_omitted(value) {
        return Ok(JSValue::UNDEFINED);
    }

    if let Err(err) = stringifier.stringify_value(global, value) {
        return match err {
            StringifyError::Js(js_err) => Err(js_err),
            StringifyError::StackOverflow => Err(global.throw_stack_overflow()),
        };
    }

    stringifier.builder.to_string(global)
}

pub(crate) fn parse<'a>(
    cx: &mut JsScope<'a>,
    input: JsBytes<'a>,
    reviver: JsLocal<'a>,
) -> JsResult<JSValue> {
    // SAFETY: parsing runs no JavaScript. Nor does making the result: its keys are primitives, and its properties are
    // defined and not set. What throws returns without reading `input` again.
    let global = unsafe { cx.heap.global() };
    let root = parse_to_value(global, input.get(&cx.heap))?;

    let reviver = reviver.to_js();
    if !reviver.is_callable() {
        return Ok(root);
    }
    root.json_revive(cx.global(), reviver)
}

fn parse_to_value(global: &JSGlobalObject, input: &[u8]) -> JsResult<JSValue> {
    super::with_text_format_source(global, input, b"input.json5", |bump, log, source| {
        let root =
            match json5::JSON5Parser::parse(source, log, bump) {
                Ok(r) => r,
                Err(json5::ExternalError::OutOfMemory) => return Err(JsError::OutOfMemory),
                Err(json5::ExternalError::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(json5::ExternalError::SyntaxError) => {
                    if !log.msgs.is_empty() {
                        let first_msg = &log.msgs[0];
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "JSON5 Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("JSON5 Parse error: Unable to parse JSON5 string",),
                    )));
                }
            };

        super::expr_to_js(root, global)
    })
}

/// `undefined`, a symbol and a function have no JSON5: a property is left out, and an array item is `null`.
fn is_omitted(value: JSValue) -> bool {
    value.is_undefined()
        || value.is_symbol()
        || value.is_function()
        || (is_proxy(value) && value.is_callable())
}

fn is_proxy(value: JSValue) -> bool {
    value.is_cell() && value.js_type() == jsc::JSType::ProxyObject
}

enum Replacer {
    None,
    /// An argument of the call, so the caller's frame keeps it alive.
    Function(JSValue),
    /// The only properties of an object to write, in this order.
    PropertyList(Vec<BunString>),
}

impl Replacer {
    fn init(global: &JSGlobalObject, replacer: JSValue) -> JsResult<Replacer> {
        if !replacer.is_object() {
            return Ok(Replacer::None);
        }
        if replacer.is_callable() {
            return Ok(Replacer::Function(replacer));
        }
        // `JSON.stringify` ignores any other object, and the `json5` package reads it as options.
        if !replacer.is_array_or_proxy_of_array(global)? {
            return Err(global.throw_type_error(format_args!(
                "JSON5.stringify replacer must be a function or an array"
            )));
        }

        let mut iter = replacer
            .json_property_list(global)?
            .array_iterator(global)?;
        let mut names = Vec::with_capacity(iter.len as usize);
        while let Some(name) = iter.next()? {
            names.push(name.to_bun_string(global)?);
        }
        Ok(Replacer::PropertyList(names))
    }
}

enum Key<'a> {
    Name(&'a BunString),
    Index(u32),
}

struct Stringifier<'a> {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    indent: usize,
    space: Space,
    replacer: &'a Replacer,
    // NOTE: `JSValue` keys live on the heap here, but every entry is also
    // live on the native stack via the `stringify_value` recursion chain, so the
    // conservative GC scan keeps them alive.
    visiting: HashMap<JSValue, ()>,
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

enum Space {
    Minified,
    Number(u32),
    /// +1 WTF ref owned for the lifetime of the `Stringifier`.
    Str(bun_core::String),
}

impl Space {
    fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Space> {
        let space = space_value.unwrap_boxed_primitive(global)?;
        if space.is_number() {
            // Clamp on the float to match the spec's min(10, ToIntegerOrInfinity(space)).
            // toInt32() wraps large values and Infinity to 0, which is wrong.
            let num_f = space.as_number();
            if num_f.is_nan() || num_f < 1.0 {
                // handles NaN, -Infinity, 0, negatives
                return Ok(Space::Minified);
            }
            return Ok(Space::Number(if num_f > 10.0 { 10 } else { num_f as u32 }));
        }
        if space.is_string() {
            let str = space.to_bun_string(global)?;
            if str.length() == 0 {
                return Ok(Space::Minified);
            }
            return Ok(Space::Str(str));
        }
        Ok(Space::Minified)
    }
}

impl<'a> Stringifier<'a> {
    fn init(
        global: &JSGlobalObject,
        replacer: &'a Replacer,
        space_value: JSValue,
    ) -> JsResult<Stringifier<'a>> {
        Ok(Stringifier {
            stack_check: StackCheck::init(),
            builder: wtf::StringBuilder::init(),
            indent: 0,
            space: Space::init(global, space_value)?,
            replacer,
            visiting: HashMap::default(),
        })
    }

    /// What to write for `holder[key]`, which is `value`: what its `toJSON5` or `toJSON` returns, and then what the
    /// replacer function makes of that. `holder` is only read by a replacer function.
    fn transform(
        &self,
        global: &JSGlobalObject,
        holder: JSValue,
        key: Key<'_>,
        value: JSValue,
    ) -> JsResult<JSValue> {
        let to_json = if value.is_cell() {
            jsc::cpp::JSC__JSValue__getToJSON5Method(value, global)?
        } else {
            JSValue::UNDEFINED
        };
        let replacer = match *self.replacer {
            Replacer::Function(function) => Some(function),
            _ => None,
        };
        if to_json.is_undefined() && replacer.is_none() {
            return Ok(value);
        }

        let key = match key {
            Key::Name(name) => name.to_js(global)?,
            Key::Index(index) => JSValue::js_number_from_uint64(u64::from(index))
                .to_js_string(global)?
                .to_js(),
        };
        let mut value = value;
        if !to_json.is_undefined() {
            value = to_json.call(global, value, &[key])?;
        }
        if let Some(replacer) = replacer {
            value = replacer.call(global, holder, &[key, value])?;
        }
        Ok(value)
    }

    fn is_pretty(&self) -> bool {
        !matches!(self.space, Space::Minified)
    }

    fn stringify_value(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }

        let unwrapped = value.unwrap_boxed_primitive(global)?;

        if unwrapped.is_null() {
            self.builder.append_latin1(b"null");
            return Ok(());
        }

        if unwrapped.is_number() {
            if unwrapped.is_int32() {
                self.builder.append_int(unwrapped.as_int32());
                return Ok(());
            }
            let num = unwrapped.as_number();
            if num.is_infinite() && num.is_sign_negative() {
                self.builder.append_latin1(b"-Infinity");
            } else if num.is_infinite() {
                self.builder.append_latin1(b"Infinity");
            } else if num.is_nan() {
                self.builder.append_latin1(b"NaN");
            } else {
                self.builder.append_double(num);
            }
            return Ok(());
        }

        if unwrapped.is_big_int() {
            return Err(global
                .throw(format_args!("JSON5.stringify cannot serialize BigInt"))
                .into());
        }

        if unwrapped.is_boolean() {
            self.builder.append_latin1(if unwrapped.as_boolean() {
                b"true"
            } else {
                b"false"
            });
            return Ok(());
        }

        if unwrapped.is_string() {
            let str = unwrapped.to_bun_string(global)?;
            self.append_quoted_string(&str);
            return Ok(());
        }

        // Object or array — check for circular references.
        // The call site is wired for fallible
        // allocation (Err → OutOfMemory), but `zig_hash_map`'s grow path currently
        // allocates infallibly and aborts on OOM, so the Err arm only becomes live
        // once the collections-side grow is made fallible.
        let was_present = self
            .visiting
            .get_or_put(unwrapped)
            .map_err(|_| StringifyError::Js(JsError::OutOfMemory))?
            .found_existing;
        if was_present {
            return Err(global
                .throw(format_args!("Converting circular structure to JSON5"))
                .into());
        }
        // NOTE: a scopeguard here would hold `&mut self.visiting` across the recursive
        // `&mut self` calls below, so remove manually after the call instead.
        let is_array = unwrapped.is_array()
            || (is_proxy(unwrapped) && unwrapped.is_array_or_proxy_of_array(global)?);
        let result = if is_array {
            self.stringify_array(global, unwrapped)
        } else {
            self.stringify_object(global, unwrapped)
        };

        self.visiting.remove(&unwrapped);
        result
    }

    fn stringify_array(&mut self, global: &JSGlobalObject, array: JSValue) -> StringifyResult<()> {
        let mut iter = array.array_iterator(global)?;

        self.builder.append_lchar(b'[');
        self.indent += 1;

        let mut index: u32 = 0;
        while let Some(item) = iter.next()? {
            if index > 0 {
                self.builder.append_lchar(b',');
            }
            self.newline();
            let item = self.transform(global, array, Key::Index(index), item)?;
            if is_omitted(item) {
                self.builder.append_latin1(b"null");
            } else {
                self.stringify_value(global, item)?;
            }
            index += 1;
        }

        self.indent -= 1;
        if index > 0 && self.is_pretty() {
            // Trailing comma
            self.builder.append_lchar(b',');
            self.newline();
        }

        self.builder.append_lchar(b']');
        Ok(())
    }

    fn stringify_object(
        &mut self,
        global: &JSGlobalObject,
        object: JSValue,
    ) -> StringifyResult<()> {
        self.builder.append_lchar(b'{');
        self.indent += 1;

        let mut first = true;
        let replacer = self.replacer;
        if let Replacer::PropertyList(names) = replacer {
            for name in names {
                let value = object.get_bun_string(global, name)?;
                self.stringify_property(global, object, name, value, &mut first)?;
            }
        } else {
            // The iterator skips a property that is gone by the time it is reached. A replacer function can delete
            // one, and is still called for it.
            let include_value = matches!(replacer, Replacer::None);
            let iter = jsc::JSPropertyIterator::init(
                global,
                object.to_object(global)?,
                jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value,
                    ..Default::default()
                },
            )?;
            while let Some((name, value)) = iter.next()? {
                let value = if include_value {
                    value
                } else {
                    object.get_bun_string(global, &name)?
                };
                self.stringify_property(global, object, &name, value, &mut first)?;
            }
        }

        self.indent -= 1;
        if !first && self.is_pretty() {
            // Trailing comma
            self.builder.append_lchar(b',');
            self.newline();
        }

        self.builder.append_lchar(b'}');
        Ok(())
    }

    fn stringify_property(
        &mut self,
        global: &JSGlobalObject,
        holder: JSValue,
        name: &BunString,
        value: JSValue,
        first: &mut bool,
    ) -> StringifyResult<()> {
        let value = self.transform(global, holder, Key::Name(name), value)?;
        if is_omitted(value) {
            return Ok(());
        }
        if !*first {
            self.builder.append_lchar(b',');
        }
        *first = false;
        self.newline();
        self.append_key(name);
        self.builder
            .append_latin1(if self.is_pretty() { b": " } else { b":" });
        self.stringify_value(global, value)
    }

    fn append_key(&mut self, name: &BunString) {
        let is_identifier = 'is_identifier: {
            if name.length() == 0 {
                break 'is_identifier false;
            }
            if !lexer::is_identifier_start(i32::from(name.char_at(0))) {
                break 'is_identifier false;
            }
            for i in 1..name.length() {
                if !lexer::is_identifier_continue(i32::from(name.char_at(i))) {
                    break 'is_identifier false;
                }
            }
            true
        };

        if is_identifier {
            self.builder.append_string(name);
        } else {
            self.append_quoted_string(name);
        }
    }

    fn append_quoted_string(&mut self, str: &BunString) {
        self.builder.append_lchar(b'\'');
        for i in 0..str.length() {
            let c = str.char_at(i);
            match c {
                0x00 => self.builder.append_latin1(b"\\0"),
                0x08 => self.builder.append_latin1(b"\\b"),
                0x09 => self.builder.append_latin1(b"\\t"),
                0x0a => self.builder.append_latin1(b"\\n"),
                0x0b => self.builder.append_latin1(b"\\v"),
                0x0c => self.builder.append_latin1(b"\\f"),
                0x0d => self.builder.append_latin1(b"\\r"),
                0x27 => self.builder.append_latin1(b"\\'"), // single quote
                0x5c => self.builder.append_latin1(b"\\\\"), // backslash
                0x2028 => self.builder.append_latin1(b"\\u2028"),
                0x2029 => self.builder.append_latin1(b"\\u2029"),
                0x01..=0x07 | 0x0e..=0x1f | 0x7f => {
                    // Other control chars → \xHH
                    self.builder.append_latin1(b"\\x");
                    self.builder
                        .append_lchar(bun_core::fmt::hex_char_lower((c >> 4) as u8));
                    self.builder
                        .append_lchar(bun_core::fmt::hex_char_lower(c as u8));
                }
                _ => self.builder.append_uchar(c),
            }
        }
        self.builder.append_lchar(b'\'');
    }

    fn newline(&mut self) {
        match &self.space {
            Space::Minified => {}
            Space::Number(space_num) => {
                self.builder.append_lchar(b'\n');
                for _ in 0..(self.indent * (*space_num as usize)) {
                    self.builder.append_lchar(b' ');
                }
            }
            Space::Str(space_str) => {
                self.builder.append_lchar(b'\n');
                let clamped = space_str.trunc(10);
                for _ in 0..self.indent {
                    self.builder.append_string(&clamped);
                }
            }
        }
    }
}
