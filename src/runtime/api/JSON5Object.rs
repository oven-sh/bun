use bun_collections::HashMap;
use bun_core::StackCheck;
use bun_interchange::json5;
use bun_jsc::{
    self as jsc, wtf, CallFrame, JSFunction, JSGlobalObject, JSValue, JsError, JsResult,
};
use bun_js_parser::{self as ast, lexer, Expr, ExprData};
use bun_logger as logger;
use bun_str::{String as BunString, ZigString};

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 2);
    object.put(
        global,
        ZigString::static_(b"parse"),
        JSFunction::create(global, b"parse", parse, 1, Default::default()),
    );
    object.put(
        global,
        ZigString::static_(b"stringify"),
        JSFunction::create(global, b"stringify", stringify, 3, Default::default()),
    );
    object
}

#[bun_jsc::host_fn]
pub fn stringify(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [value, replacer, space_value] = frame.arguments_as_array::<3>();

    value.ensure_still_alive();

    if value.is_undefined() || value.is_symbol() || value.is_function() {
        return Ok(JSValue::UNDEFINED);
    }

    if !replacer.is_undefined_or_null() {
        return global.throw("JSON5.stringify does not support the replacer argument");
    }

    let mut stringifier = Stringifier::init(global, space_value)?;

    if let Err(err) = stringifier.stringify_value(global, value) {
        return match err {
            StringifyError::Js(js_err) => Err(js_err),
            StringifyError::StackOverflow => global.throw_stack_overflow(),
        };
    }

    stringifier.builder.to_string(global)
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PERF(port): was arena bulk-free — this scope feeds the AST parser, which is
    // arena-backed in the original. Phase B should thread a `bumpalo::Bump` here
    // matching `bun_js_parser`'s allocator API.
    let bump = bun_alloc::Arena::new();

    // TODO(port): ASTMemoryAllocator scope — the Zig enters a typed-slab scope so
    // Expr/Stmt nodes allocate from `bump`. Mirror whatever `bun_js_parser`
    // exposes for this (likely `ast::MemoryAllocator::enter(&bump)`).
    let mut ast_memory_allocator = ast::ASTMemoryAllocator::new(&bump);
    let _ast_scope = ast_memory_allocator.enter();

    let input_value = frame.argument(0);

    if input_value.is_empty_or_undefined_or_null() {
        return global.throw_invalid_arguments("Expected a string to parse");
    }

    let input: jsc::node::BlobOrStringOrBuffer = match jsc::node::BlobOrStringOrBuffer::from_js(
        global,
        input_value,
    )? {
        Some(v) => v,
        None => 'input: {
            let str = input_value.to_bun_string(global)?;
            break 'input jsc::node::BlobOrStringOrBuffer::StringOrBuffer(
                jsc::node::StringOrBuffer::String(str.to_slice()),
            );
            // PORT NOTE: `str.deref()` handled by Drop on `BunString`; the slice
            // borrows/clones as needed inside `to_slice`.
        }
    };

    let mut log = logger::Log::init();

    let source = logger::Source::init_path_string(b"input.json5", input.slice());

    let root = match json5::JSON5Parser::parse(&source, &mut log, &bump) {
        Ok(r) => r,
        Err(e) if e == bun_core::err!("OutOfMemory") => return Err(JsError::OutOfMemory),
        Err(e) if e == bun_core::err!("StackOverflow") => return global.throw_stack_overflow(),
        Err(_) => {
            if !log.msgs.is_empty() {
                let first_msg = &log.msgs[0];
                return global.throw_value(global.create_syntax_error_instance(format_args!(
                    "JSON5 Parse error: {}",
                    bstr::BStr::new(&first_msg.data.text),
                )));
            }
            return global.throw_value(global.create_syntax_error_instance(format_args!(
                "JSON5 Parse error: Unable to parse JSON5 string",
            )));
        }
    };

    expr_to_js(root, global)
}

struct Stringifier {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    indent: usize,
    space: Space,
    // PORT NOTE: `JSValue` keys live on the heap here, but every entry is also
    // live on the native stack via the `stringify_value` recursion chain, so the
    // conservative GC scan keeps them alive. Matches the Zig.
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
    Str(BunString),
}

impl Space {
    pub fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Space> {
        let space = space_value.unwrap_boxed_primitive(global)?;
        if space.is_number() {
            // Clamp on the float to match the spec's min(10, ToIntegerOrInfinity(space)).
            // toInt32() wraps large values and Infinity to 0, which is wrong.
            let num_f = space.as_number();
            if !(num_f >= 1.0) {
                // handles NaN, -Infinity, 0, negatives
                return Ok(Space::Minified);
            }
            return Ok(Space::Number(if num_f > 10.0 { 10 } else { num_f as u32 }));
        }
        if space.is_string() {
            let str = space.to_bun_string(global)?;
            if str.length() == 0 {
                // `str` drops here (deref)
                return Ok(Space::Minified);
            }
            return Ok(Space::Str(str));
        }
        Ok(Space::Minified)
    }
}

// PORT NOTE: `Space::deinit` deleted — `BunString` field derefs via `Drop`.

impl Stringifier {
    pub fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Stringifier> {
        Ok(Stringifier {
            stack_check: StackCheck::init(),
            builder: wtf::StringBuilder::init(),
            indent: 0,
            space: Space::init(global, space_value)?,
            visiting: HashMap::default(),
        })
    }

    // PORT NOTE: `deinit` deleted — all fields (`builder`, `space`, `visiting`)
    // free via `Drop`.

    pub fn stringify_value(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> StringifyResult<()> {
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
                .throw("JSON5.stringify cannot serialize BigInt")
                .unwrap_err()
                .into());
        }

        if unwrapped.is_boolean() {
            self.builder
                .append_latin1(if unwrapped.as_boolean() { b"true" } else { b"false" });
            return Ok(());
        }

        if unwrapped.is_string() {
            let str = unwrapped.to_bun_string(global)?;
            self.append_quoted_string(&str);
            return Ok(());
        }

        // Object or array — check for circular references
        // TODO(port): narrow error set — `try_insert`/`get_or_put` OOM maps to JsError::OutOfMemory
        let was_present = self.visiting.insert(unwrapped, ()).is_some();
        if was_present {
            return Err(global
                .throw("Converting circular structure to JSON5")
                .unwrap_err()
                .into());
        }
        // PORT NOTE: reshaped for borrowck — Zig used `defer visiting.remove`;
        // a scopeguard here would hold `&mut self.visiting` across the recursive
        // `&mut self` calls below, so remove manually after the call instead.
        let result = if unwrapped.is_array() {
            self.stringify_array(global, unwrapped)
        } else {
            self.stringify_object(global, unwrapped)
        };

        self.visiting.remove(&unwrapped);
        result
    }

    fn stringify_array(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> StringifyResult<()> {
        let mut iter = value.array_iterator(global)?;

        if iter.len == 0 {
            self.builder.append_latin1(b"[]");
            return Ok(());
        }

        self.builder.append_lchar(b'[');

        match self.space {
            Space::Minified => {
                let mut first = true;
                while let Some(item) = iter.next()? {
                    if !first {
                        self.builder.append_lchar(b',');
                    }
                    first = false;
                    if item.is_undefined() || item.is_symbol() || item.is_function() {
                        self.builder.append_latin1(b"null");
                    } else {
                        self.stringify_value(global, item)?;
                    }
                }
            }
            Space::Number(_) | Space::Str(_) => {
                self.indent += 1;
                let mut first = true;
                while let Some(item) = iter.next()? {
                    if !first {
                        self.builder.append_lchar(b',');
                    }
                    first = false;
                    self.newline();
                    if item.is_undefined() || item.is_symbol() || item.is_function() {
                        self.builder.append_latin1(b"null");
                    } else {
                        self.stringify_value(global, item)?;
                    }
                }
                // Trailing comma
                self.builder.append_lchar(b',');
                self.indent -= 1;
                self.newline();
            }
        }

        self.builder.append_lchar(b']');
        Ok(())
    }

    fn stringify_object(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> StringifyResult<()> {
        // TODO(port): JSPropertyIterator comptime options
        // (`.{ .skip_empty_name = false, .include_value = true }`). Phase B:
        // wire to whatever const-generic / config-struct API `bun_jsc` exposes.
        let mut iter = jsc::JSPropertyIterator::init(
            global,
            value.to_object(global)?,
            jsc::JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
            },
        )?;

        if iter.len == 0 {
            self.builder.append_latin1(b"{}");
            return Ok(());
        }

        self.builder.append_lchar(b'{');

        match self.space {
            Space::Minified => {
                let mut first = true;
                while let Some(prop_name) = iter.next()? {
                    if iter.value.is_undefined()
                        || iter.value.is_symbol()
                        || iter.value.is_function()
                    {
                        continue;
                    }
                    if !first {
                        self.builder.append_lchar(b',');
                    }
                    first = false;
                    self.append_key(&prop_name);
                    self.builder.append_lchar(b':');
                    self.stringify_value(global, iter.value)?;
                }
            }
            Space::Number(_) | Space::Str(_) => {
                self.indent += 1;
                let mut first = true;
                while let Some(prop_name) = iter.next()? {
                    if iter.value.is_undefined()
                        || iter.value.is_symbol()
                        || iter.value.is_function()
                    {
                        continue;
                    }
                    if !first {
                        self.builder.append_lchar(b',');
                    }
                    first = false;
                    self.newline();
                    self.append_key(&prop_name);
                    self.builder.append_latin1(b": ");
                    self.stringify_value(global, iter.value)?;
                }
                self.indent -= 1;
                if !first {
                    // Trailing comma
                    self.builder.append_lchar(b',');
                    self.newline();
                }
            }
        }

        self.builder.append_lchar(b'}');
        Ok(())
    }

    fn append_key(&mut self, name: &BunString) {
        let is_identifier = 'is_identifier: {
            if name.length() == 0 {
                break 'is_identifier false;
            }
            if !lexer::is_identifier_start(u32::from(name.char_at(0))) {
                break 'is_identifier false;
            }
            for i in 1..name.length() {
                if !lexer::is_identifier_continue(u32::from(name.char_at(i))) {
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
                    self.builder.append_lchar(hex_digit(c >> 4));
                    self.builder.append_lchar(hex_digit(c & 0x0f));
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
                let clamped = if space_str.length() > 10 {
                    space_str.substring_with_len(0, 10)
                } else {
                    space_str.clone()
                };
                for _ in 0..self.indent {
                    self.builder.append_string(&clamped);
                }
            }
        }
    }
}

fn hex_digit(v: u16) -> u8 {
    let nibble = u8::try_from(v & 0x0f).unwrap();
    if nibble < 10 {
        b'0' + nibble
    } else {
        b'a' + nibble - 10
    }
}

fn expr_to_js(expr: Expr, global: &JSGlobalObject) -> JsResult<JSValue> {
    match expr.data {
        ExprData::ENull => Ok(JSValue::NULL),
        ExprData::EBoolean(boolean) => Ok(JSValue::from(boolean.value)),
        ExprData::ENumber(number) => Ok(JSValue::js_number(number.value)),
        ExprData::EString(str) => {
            // TODO(port): move to *_jsc — `EString::to_js` is a JSC extension method.
            str.to_js(global)
        }
        ExprData::EArray(arr) => {
            let js_arr = JSValue::create_empty_array(global, arr.items.len())?;
            for (_i, item) in arr.slice().iter().enumerate() {
                let i = u32::try_from(_i).unwrap();
                let value = expr_to_js(*item, global)?;
                js_arr.put_index(global, i, value)?;
            }
            Ok(js_arr)
        }
        ExprData::EObject(obj) => {
            let js_obj = JSValue::create_empty_object(global, obj.properties.len());
            for prop in obj.properties.slice() {
                let key_expr = prop.key.unwrap();
                let value = expr_to_js(prop.value.unwrap(), global)?;
                let key_js = expr_to_js(key_expr, global)?;
                let key_str = key_js.to_bun_string(global)?;
                js_obj.put_may_be_index(global, &key_str, value)?;
            }
            Ok(js_obj)
        }
        _ => Ok(JSValue::UNDEFINED),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/JSON5Object.zig (433 lines)
//   confidence: medium
//   todos:      4
//   notes:      parse() arena/ASTMemoryAllocator threading + JSPropertyIterator options API need Phase B wiring; `defer visiting.remove` reshaped for borrowck (manual remove, no scopeguard).
// ──────────────────────────────────────────────────────────────────────────
