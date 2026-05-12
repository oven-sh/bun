use bun_collections::VecExt;
use core::ffi::c_void;

use bun_ast::{Expr, expr::Data as ExprData};
use bun_collections::{HashMap, StringHashMap};
use bun_core::StackCheck;
use bun_core::{OwnedString, String as BunString};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue,
    JsError, JsResult, MarkedArgumentBuffer, wtf,
};
use bun_parsers::yaml::{YAML, YamlParseError};

pub fn create(global_this: &JSGlobalObject) -> JSValue {
    jsc::create_host_function_object(
        global_this,
        &[
            ("parse", __jsc_host_parse, 1),
            ("stringify", __jsc_host_stringify, 3),
        ],
    )
}

#[bun_jsc::host_fn]
pub fn stringify(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let [value, replacer, space_value] = call_frame.arguments_as_array::<3>();

    value.ensure_still_alive();

    if value.is_undefined() || value.is_symbol() || value.is_function() {
        return Ok(JSValue::UNDEFINED);
    }

    if !replacer.is_undefined_or_null() {
        return Err(global.throw(format_args!(
            "YAML.stringify does not support the replacer argument"
        )));
    }

    let mut stringifier = Stringifier::init(global, space_value)?;

    if let Err(err) = stringifier.find_anchors_and_aliases(global, value, ValueOrigin::Root) {
        return match err {
            StringifyError::OutOfMemory => Err(JsError::OutOfMemory),
            StringifyError::JsError => Err(JsError::Thrown),
            StringifyError::JsTerminated => Err(JsError::Terminated),
            StringifyError::StackOverflow => Err(global.throw_stack_overflow()),
        };
    }

    if let Err(err) = stringifier.stringify(global, value) {
        return match err {
            StringifyError::OutOfMemory => Err(JsError::OutOfMemory),
            StringifyError::JsError => Err(JsError::Thrown),
            StringifyError::JsTerminated => Err(JsError::Terminated),
            StringifyError::StackOverflow => Err(global.throw_stack_overflow()),
        };
    }

    stringifier.builder.to_string(global)
}

pub struct Stringifier {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    indent: usize,

    known_collections: HashMap<JSValue, AnchorAlias>,
    array_item_counter: usize,
    prop_names: StringHashMap<usize>,

    space: Space,
}

pub enum Space {
    Minified,
    Number(u32),
    /// +1 WTF ref owned for the lifetime of the `Stringifier` (Zig:
    /// `Space.deinit() → str.deref()`).
    Str(OwnedString),
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
            let str = OwnedString::new(space.to_bun_string(global)?);
            if str.length() == 0 {
                return Ok(Space::Minified);
            }
            return Ok(Space::Str(str));
        }

        Ok(Space::Minified)
    }
}

#[repr(u8)]
pub enum AnchorOrigin {
    Root,
    ArrayItem,
    PropValue,
}

pub struct AnchorAlias {
    anchored: bool,
    used: bool,
    name: AnchorAliasName,
}

impl Default for AnchorAlias {
    fn default() -> Self {
        // PORT NOTE: `HashMap::get_or_put` requires `V: Default` to fill the
        // freshly-inserted slot before the caller overwrites `*value_ptr`. Zig
        // left it `undefined`; this is the closest legal Rust equivalent and is
        // immediately overwritten by the caller (see `find_anchors_and_aliases`).
        AnchorAlias {
            anchored: false,
            used: false,
            name: AnchorAliasName::Root,
        }
    }
}

impl AnchorAlias {
    pub fn init(origin: ValueOrigin) -> AnchorAlias {
        AnchorAlias {
            anchored: false,
            used: false,
            name: match origin {
                ValueOrigin::Root => AnchorAliasName::Root,
                ValueOrigin::ArrayItem => AnchorAliasName::ArrayItem(0),
                ValueOrigin::PropValue(prop_name) => AnchorAliasName::PropValue {
                    prop_name,
                    counter: 0,
                },
            },
        }
    }
}

pub enum AnchorAliasName {
    // only one root anchor is possible
    Root,
    ArrayItem(usize),
    PropValue {
        prop_name: BunString,
        // added after the name
        counter: usize,
    },
}

pub enum ValueOrigin {
    Root,
    ArrayItem,
    PropValue(BunString),
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum StringifyError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("JSError")]
    JsError,
    #[error("JSTerminated")]
    JsTerminated,
    #[error("StackOverflow")]
    StackOverflow,
}

impl From<JsError> for StringifyError {
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => StringifyError::OutOfMemory,
            JsError::Thrown => StringifyError::JsError,
            JsError::Terminated => StringifyError::JsTerminated,
        }
    }
}

bun_core::oom_from_alloc!(StringifyError);

impl Stringifier {
    pub fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Stringifier> {
        let mut prop_names: StringHashMap<usize> = StringHashMap::default();
        // always rename anchors named "root" to avoid collision with
        // root anchor/alias
        prop_names.put(b"root", 0)?;

        Ok(Stringifier {
            stack_check: StackCheck::init(),
            builder: wtf::StringBuilder::init(),
            indent: 0,
            known_collections: HashMap::default(),
            array_item_counter: 0,
            prop_names,
            space: Space::init(global, space_value)?,
        })
    }

    // deinit: all fields have Drop (`space: Space::Str` holds an
    // `OwnedString`); no explicit impl needed.

    pub fn find_anchors_and_aliases(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
        origin: ValueOrigin,
    ) -> Result<(), StringifyError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }

        let unwrapped = value.unwrap_boxed_primitive(global)?;

        if unwrapped.is_null() {
            return Ok(());
        }

        if unwrapped.is_number() {
            return Ok(());
        }

        if unwrapped.is_big_int() {
            return Err(global
                .throw(format_args!("YAML.stringify cannot serialize BigInt"))
                .into());
        }

        if unwrapped.is_boolean() {
            return Ok(());
        }

        if unwrapped.is_string() {
            return Ok(());
        }

        // PORT NOTE: `bun.Environment.ci_assert` → `debug_assert!` (closest analogue;
        // `bun.assertWithLocation(cond, @src())` is a debug-only assert with source location).
        debug_assert!(unwrapped.is_object());

        let object_entry = self.known_collections.get_or_put(unwrapped)?;
        if object_entry.found_existing {
            // this will become an alias. increment counters here because
            // now the anchor/alias is confirmed used.

            if object_entry.value_ptr.used {
                return Ok(());
            }

            object_entry.value_ptr.used = true;

            match &mut object_entry.value_ptr.name {
                AnchorAliasName::Root => {
                    // only one possible
                }
                AnchorAliasName::ArrayItem(counter) => {
                    *counter = self.array_item_counter;
                    self.array_item_counter += 1;
                }
                AnchorAliasName::PropValue { prop_name, counter } => {
                    let name_entry = self.prop_names.get_or_put(prop_name.byte_slice())?;
                    if name_entry.found_existing {
                        *name_entry.value_ptr += 1;
                    } else {
                        *name_entry.value_ptr = 0;
                    }

                    *counter = *name_entry.value_ptr;
                }
            }
            return Ok(());
        }

        *object_entry.value_ptr = AnchorAlias::init(origin);

        if unwrapped.is_array() {
            let mut iter = unwrapped.array_iterator(global)?;
            while let Some(item) = iter.next()? {
                if item.is_undefined() || item.is_symbol() || item.is_function() {
                    continue;
                }

                self.find_anchors_and_aliases(global, item, ValueOrigin::ArrayItem)?;
            }
            return Ok(());
        }

        // const generics: <SKIP_EMPTY_NAME, INCLUDE_VALUE>
        let mut iter = JSPropertyIterator::init(
            global,
            unwrapped.to_object(global)?,
            JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;

        while let Some(prop_name) = iter.next()? {
            if iter.value.is_undefined() || iter.value.is_symbol() || iter.value.is_function() {
                continue;
            }
            self.find_anchors_and_aliases(global, iter.value, ValueOrigin::PropValue(prop_name))?;
        }

        Ok(())
    }

    pub fn stringify(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), StringifyError> {
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
                self.builder.append_latin1(b"-.inf");
                // } else if num.is_infinite() && num.is_sign_positive() {
                //     builder.append_latin1(b"+.inf");
            } else if num.is_infinite() {
                self.builder.append_latin1(b".inf");
            } else if num.is_nan() {
                self.builder.append_latin1(b".nan");
            } else if num == 0.0 && num.is_sign_negative() {
                self.builder.append_latin1(b"-0");
            } else if num == 0.0 && num.is_sign_positive() {
                self.builder.append_latin1(b"+0");
            } else {
                self.builder.append_double(num);
            }
            return Ok(());
        }

        if unwrapped.is_big_int() {
            return Err(global
                .throw(format_args!("YAML.stringify cannot serialize BigInt"))
                .into());
        }

        if unwrapped.is_boolean() {
            if unwrapped.as_boolean() {
                self.builder.append_latin1(b"true");
            } else {
                self.builder.append_latin1(b"false");
            }
            return Ok(());
        }

        if unwrapped.is_string() {
            let value_str = OwnedString::new(unwrapped.to_bun_string(global)?);
            self.append_string(&value_str);
            return Ok(());
        }

        // PORT NOTE: `bun.Environment.ci_assert` → `debug_assert!` (closest analogue;
        // `bun.assertWithLocation(cond, @src())` is a debug-only assert with source location).
        debug_assert!(unwrapped.is_object());

        let has_anchor: Option<&mut AnchorAlias> = 'has_anchor: {
            let Some(anchor) = self.known_collections.get_mut(&unwrapped) else {
                break 'has_anchor None;
            };

            if !anchor.used {
                break 'has_anchor None;
            }

            Some(anchor)
        };

        if let Some(anchor) = has_anchor {
            self.builder
                .append_lchar(if anchor.anchored { b'*' } else { b'&' });

            match &anchor.name {
                AnchorAliasName::Root => {
                    self.builder.append_latin1(b"root");
                }
                AnchorAliasName::ArrayItem(counter) => {
                    self.builder.append_latin1(b"item");
                    self.builder.append_usize(*counter);
                }
                AnchorAliasName::PropValue { prop_name, counter } => {
                    if prop_name.length() == 0 {
                        self.builder.append_latin1(b"value");
                        self.builder.append_usize(*counter);
                    } else {
                        self.builder.append_string(*prop_name);
                        if *counter != 0 {
                            self.builder.append_usize(*counter);
                        }
                    }
                }
            }

            if anchor.anchored {
                return Ok(());
            }

            // PORT NOTE: reshaped for borrowck — set anchored before newline()
            anchor.anchored = true;
            match self.space {
                Space::Minified => {
                    self.builder.append_lchar(b' ');
                }
                Space::Number(_) | Space::Str(_) => {
                    self.newline();
                }
            }
        }

        if unwrapped.is_array() {
            let mut iter = unwrapped.array_iterator(global)?;

            if iter.len == 0 {
                self.builder.append_latin1(b"[]");
                return Ok(());
            }

            match self.space {
                Space::Minified => {
                    self.builder.append_lchar(b'[');
                    let mut first = true;
                    while let Some(item) = iter.next()? {
                        if item.is_undefined() || item.is_symbol() || item.is_function() {
                            continue;
                        }

                        if !first {
                            self.builder.append_lchar(b',');
                        }
                        first = false;

                        self.stringify(global, item)?;
                    }
                    self.builder.append_lchar(b']');
                }
                Space::Number(_) | Space::Str(_) => {
                    self.builder
                        .ensure_unused_capacity(iter.len as usize * b"- ".len());
                    let mut first = true;
                    while let Some(item) = iter.next()? {
                        if item.is_undefined() || item.is_symbol() || item.is_function() {
                            continue;
                        }

                        if !first {
                            self.newline();
                        }
                        first = false;

                        self.builder.append_latin1(b"- ");

                        // don't need to print a newline here for any value

                        self.indent += 1;
                        self.stringify(global, item)?;
                        self.indent -= 1;
                    }
                }
            }

            return Ok(());
        }

        // const generics: <SKIP_EMPTY_NAME, INCLUDE_VALUE>
        let mut iter = JSPropertyIterator::init(
            global,
            unwrapped.to_object(global)?,
            JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;

        if iter.len == 0 {
            self.builder.append_latin1(b"{}");
            return Ok(());
        }

        match self.space {
            Space::Minified => {
                self.builder.append_lchar(b'{');
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

                    self.append_string(&prop_name);
                    self.builder.append_latin1(b": ");

                    self.stringify(global, iter.value)?;
                }
                self.builder.append_lchar(b'}');
            }
            Space::Number(_) | Space::Str(_) => {
                self.builder.ensure_unused_capacity(iter.len * b": ".len());

                let mut first = true;
                while let Some(prop_name) = iter.next()? {
                    if iter.value.is_undefined()
                        || iter.value.is_symbol()
                        || iter.value.is_function()
                    {
                        continue;
                    }

                    if !first {
                        self.newline();
                    }
                    first = false;

                    self.append_string(&prop_name);
                    self.builder.append_latin1(b": ");

                    self.indent += 1;

                    if prop_value_needs_newline(iter.value) {
                        self.newline();
                    }

                    self.stringify(global, iter.value)?;
                    self.indent -= 1;
                }
                if first {
                    self.builder.append_latin1(b"{}");
                }
            }
        }

        Ok(())
    }

    fn newline(&mut self) {
        let indent_count = self.indent;

        match &self.space {
            Space::Minified => {}
            Space::Number(space_num) => {
                let space_num = *space_num as usize;
                self.builder.append_lchar(b'\n');
                self.builder
                    .ensure_unused_capacity(indent_count * space_num);
                for _ in 0..indent_count * space_num {
                    self.builder.append_lchar(b' ');
                }
            }
            Space::Str(space_str) => {
                self.builder.append_lchar(b'\n');

                let clamped: BunString = if space_str.length() > 10 {
                    space_str.substring_with_len(0, 10)
                } else {
                    **space_str
                };

                self.builder
                    .ensure_unused_capacity(indent_count * clamped.length());
                for _ in 0..indent_count {
                    self.builder.append_string(clamped);
                }
            }
        }
    }

    fn append_double_quoted_string(&mut self, str: &BunString) {
        self.builder.append_lchar(b'"');

        for i in 0..str.length() {
            let c = str.char_at(i);

            match c {
                0x00 => self.builder.append_latin1(b"\\0"),
                0x01 => self.builder.append_latin1(b"\\x01"),
                0x02 => self.builder.append_latin1(b"\\x02"),
                0x03 => self.builder.append_latin1(b"\\x03"),
                0x04 => self.builder.append_latin1(b"\\x04"),
                0x05 => self.builder.append_latin1(b"\\x05"),
                0x06 => self.builder.append_latin1(b"\\x06"),
                0x07 => self.builder.append_latin1(b"\\a"), // bell
                0x08 => self.builder.append_latin1(b"\\b"), // backspace
                0x09 => self.builder.append_latin1(b"\\t"), // tab
                0x0a => self.builder.append_latin1(b"\\n"), // line feed
                0x0b => self.builder.append_latin1(b"\\v"), // vertical tab
                0x0c => self.builder.append_latin1(b"\\f"), // form feed
                0x0d => self.builder.append_latin1(b"\\r"), // carriage return
                0x0e => self.builder.append_latin1(b"\\x0e"),
                0x0f => self.builder.append_latin1(b"\\x0f"),
                0x10 => self.builder.append_latin1(b"\\x10"),
                0x11 => self.builder.append_latin1(b"\\x11"),
                0x12 => self.builder.append_latin1(b"\\x12"),
                0x13 => self.builder.append_latin1(b"\\x13"),
                0x14 => self.builder.append_latin1(b"\\x14"),
                0x15 => self.builder.append_latin1(b"\\x15"),
                0x16 => self.builder.append_latin1(b"\\x16"),
                0x17 => self.builder.append_latin1(b"\\x17"),
                0x18 => self.builder.append_latin1(b"\\x18"),
                0x19 => self.builder.append_latin1(b"\\x19"),
                0x1a => self.builder.append_latin1(b"\\x1a"),
                0x1b => self.builder.append_latin1(b"\\e"), // escape
                0x1c => self.builder.append_latin1(b"\\x1c"),
                0x1d => self.builder.append_latin1(b"\\x1d"),
                0x1e => self.builder.append_latin1(b"\\x1e"),
                0x1f => self.builder.append_latin1(b"\\x1f"),
                0x22 => self.builder.append_latin1(b"\\\""), // "
                0x5c => self.builder.append_latin1(b"\\\\"), // \
                0x7f => self.builder.append_latin1(b"\\x7f"), // delete
                0x85 => self.builder.append_latin1(b"\\N"),  // next line
                0xa0 => self.builder.append_latin1(b"\\_"),  // non-breaking space
                0xa8 => self.builder.append_latin1(b"\\L"),  // line separator
                0xa9 => self.builder.append_latin1(b"\\P"),  // paragraph separator

                0x20..=0x21
                | 0x23..=0x5b
                | 0x5d..=0x7e
                | 0x80..=0x84
                | 0x86..=0x9f
                | 0xa1..=0xa7
                | 0xaa..=u16::MAX => self.builder.append_uchar(c),
            }
        }

        self.builder.append_lchar(b'"');
    }

    fn append_string(&mut self, str: &BunString) {
        if string_needs_quotes(str) {
            self.append_double_quoted_string(str);
            return;
        }
        self.builder.append_string(*str);
    }
}

/// Does this object property value need a newline? True for arrays and objects.
fn prop_value_needs_newline(value: JSValue) -> bool {
    !value.is_number() && !value.is_boolean() && !value.is_null() && !value.is_string()
}

fn string_needs_quotes(str: &BunString) -> bool {
    if str.is_empty() {
        return true;
    }

    match str.char_at(str.length() - 1) {
        // whitespace characters
        0x20 /* ' ' */
        | 0x09 /* '\t' */
        | 0x0a /* '\n' */
        | 0x0d /* '\r' */
        // trailing colon can be misinterpreted as a mapping indicator
        // https://github.com/oven-sh/bun/issues/25439
        | 0x3a /* ':' */ => return true,
        _ => {}
    }

    match str.char_at(0) {
        // starting with an indicator character requires quotes
        0x26 /* '&' */
        | 0x2a /* '*' */
        | 0x3f /* '?' */
        | 0x7c /* '|' */
        | 0x2d /* '-' */
        | 0x3c /* '<' */
        | 0x3e /* '>' */
        | 0x21 /* '!' */
        | 0x25 /* '%' */
        | 0x40 /* '@' */
        | 0x3a /* ':' */
        | 0x2c /* ',' */
        | 0x5b /* '[' */
        | 0x5d /* ']' */
        | 0x7b /* '{' */
        | 0x7d /* '}' */
        | 0x23 /* '#' */
        | 0x27 /* '\'' */
        | 0x22 /* '"' */
        | 0x60 /* '`' */
        // starting with whitespace requires quotes
        | 0x20 /* ' ' */
        | 0x09 /* '\t' */
        | 0x0a /* '\n' */
        | 0x0d /* '\r' */ => return true,

        _ => {}
    }

    const KEYWORDS: &[&[u8]] = &[
        b"true", b"True", b"TRUE", b"false", b"False", b"FALSE", b"yes", b"Yes", b"YES", b"no",
        b"No", b"NO", b"on", b"On", b"ON", b"off", b"Off", b"OFF", b"n", b"N", b"y", b"Y", b"null",
        b"Null", b"NULL", b"~", b".inf", b".Inf", b".INF", b".nan", b".NaN", b".NAN",
    ];

    for keyword in KEYWORDS {
        if str.eql_comptime(keyword) {
            return true;
        }
    }

    let mut i: usize = 0;
    while i < str.length() {
        match str.char_at(i) {
            // flow indicators need to be quoted always
            0x7b /* '{' */
            | 0x7d /* '}' */
            | 0x5b /* '[' */
            | 0x5d /* ']' */
            | 0x2c /* ',' */ => return true,

            0x3a /* ':' */ => {
                if i + 1 < str.length() {
                    match str.char_at(i + 1) {
                        0x20 /* ' ' */
                        | 0x09 /* '\t' */
                        | 0x0a /* '\n' */
                        | 0x0d /* '\r' */ => return true,
                        _ => {}
                    }
                }
                i += 1;
            }

            0x23 /* '#' */
            | 0x60 /* '`' */
            | 0x27 /* '\'' */ => return true,

            0x2d /* '-' */ => {
                if i + 2 < str.length()
                    && str.char_at(i + 1) == 0x2d /* '-' */
                    && str.char_at(i + 2) == 0x2d /* '-' */
                {
                    if i + 3 >= str.length() {
                        return true;
                    }
                    match str.char_at(i + 3) {
                        0x20 /* ' ' */
                        | 0x09 /* '\t' */
                        | 0x0d /* '\r' */
                        | 0x0a /* '\n' */
                        | 0x5b /* '[' */
                        | 0x5d /* ']' */
                        | 0x7b /* '{' */
                        | 0x7d /* '}' */
                        | 0x2c /* ',' */ => return true,
                        _ => {}
                    }
                }

                if i == 0 && string_is_number(str) {
                    return true;
                }
                i += 1;
            }
            0x2e /* '.' */ => {
                if i + 2 < str.length()
                    && str.char_at(i + 1) == 0x2e /* '.' */
                    && str.char_at(i + 2) == 0x2e /* '.' */
                {
                    if i + 3 >= str.length() {
                        return true;
                    }
                    match str.char_at(i + 3) {
                        0x20 /* ' ' */
                        | 0x09 /* '\t' */
                        | 0x0d /* '\r' */
                        | 0x0a /* '\n' */
                        | 0x5b /* '[' */
                        | 0x5d /* ']' */
                        | 0x7b /* '{' */
                        | 0x7d /* '}' */
                        | 0x2c /* ',' */ => return true,
                        _ => {}
                    }
                }

                if i == 0 && string_is_number(str) {
                    return true;
                }
                i += 1;
            }

            0x30..=0x39 /* '0'..='9' */ => {
                if i == 0 && string_is_number(str) {
                    return true;
                }
                i += 1;
            }

            0x2b /* '+' */ => {
                // Leading '+' followed by digits/dot parses as a positive number.
                if i == 0 && string_is_number(str) {
                    return true;
                }
                i += 1;
            }

            0x00..=0x1f
            | 0x22
            | 0x7f
            | 0x85
            | 0xa0
            | 0xa8
            | 0xa9 => return true,

            _ => {
                i += 1;
            }
        }
    }

    false
}

/// Returns true when `str` would be parsed back as a number by `YAML.parse`.
///
/// This mirrors the rules in `src/interchange/yaml.zig`'s `tryResolveNumber`:
/// - Optional leading sign, optionally followed by `.inf`/`.Inf`/`.INF` for signed infinity.
/// - Otherwise a numeric mantissa: digits/`.`/`e`/`E`/hex letters, plus additional `+`/`-`
///   (the parser accepts any number of `+` after the leading sign as long as no `x` was
///   seen, and at most one additional `-`).
/// - `0x` / `0X` → hex digits; `0o` / `0O` → octal digits.
/// - Additionally, `wtf.parseDouble` is a prefix parser, so a leading numeric prefix is
///   enough for `YAML.parse` to resolve a number — e.g. `"1+5"` round-trips to `1`.
///   We err on the side of quoting when the parser's scanner would accept the full token
///   as `valid`.
fn string_is_number(str: &BunString) -> bool {
    let len = str.length();
    if len == 0 {
        return false;
    }

    let mut i: usize = 0;

    // Optional leading sign.
    let first = str.char_at(0);
    let signed = first == 0x2b /* '+' */ || first == 0x2d /* '-' */;
    if signed {
        i = 1;
        if i >= len {
            return false; // bare "+" / "-" isn't a number
        }
        // Signed special floats: "+.inf", "+.Inf", "+.INF" (and the '-' variants).
        // The parser also rejects ".nan" after a sign, so we only check ".inf" here.
        if str.char_at(i) == 0x2e /* '.' */ && is_inf_suffix(str, i) {
            return true;
        }
    }

    // Hex / octal base prefix.
    #[derive(PartialEq, Eq)]
    enum Base {
        Dec,
        Hex,
        Oct,
    }
    let mut base = Base::Dec;
    if i + 1 < len && str.char_at(i) == 0x30
    /* '0' */
    {
        match str.char_at(i + 1) {
            0x78 | 0x58 /* 'x' | 'X' */ => {
                base = Base::Hex;
                i += 2;
                if i >= len {
                    return false; // "0x" alone isn't hex
                }
            }
            0x6f | 0x4f /* 'o' | 'O' */ => {
                base = Base::Oct;
                i += 2;
                if i >= len {
                    return false; // "0o" alone isn't oct
                }
            }
            _ => {}
        }
    }

    // Scan the rest. Track the minimal state the parser uses to decide validity.
    let mut saw_dot = false;
    let mut saw_exp = false;
    let mut saw_minus_after_sign = false;

    while i < len {
        let c = str.char_at(i);
        match c {
            0x30..=0x39 /* '0'..='9' */ => {}
            0x61..=0x64 /* 'a'..='d' */
            | 0x66 /* 'f' */
            | 0x41..=0x44 /* 'A'..='D' */
            | 0x46 /* 'F' */ => {
                // Hex digits only valid in hex base.
                if base != Base::Hex {
                    return false;
                }
            }
            0x65 | 0x45 /* 'e' | 'E' */ => {
                if base == Base::Dec {
                    if saw_exp {
                        return false;
                    }
                    saw_exp = true;
                }
                // In hex base, 'e'/'E' are just hex digits.
            }
            0x2e /* '.' */ => {
                if saw_dot || base != Base::Dec {
                    return false;
                }
                saw_dot = true;
            }
            0x2b /* '+' */ => {
                // Parser rule: '+' accepted unless we're in hex base.
                if base == Base::Hex {
                    return false;
                }
            }
            0x2d /* '-' */ => {
                // Parser rule: at most one '-' after the leading sign.
                if saw_minus_after_sign {
                    return false;
                }
                saw_minus_after_sign = true;
            }
            _ => return false,
        }
        i += 1;
    }
    true
}

/// True if the three chars after position `i` (which is a `.`) spell "inf", "Inf",
/// or "INF" — the suffix the YAML parser accepts after a signed `.` to mean
/// +/- infinity. Over-matches `+.infX` etc., which is harmless for the quoting
/// decision.
fn is_inf_suffix(str: &BunString, i: usize) -> bool {
    if i + 4 > str.length() {
        return false;
    }
    let a = str.char_at(i + 1);
    let b = str.char_at(i + 2);
    let c = str.char_at(i + 3);
    (a == 0x69 /* 'i' */ && b == 0x6e /* 'n' */ && c == 0x66/* 'f' */)
        || (a == 0x49 /* 'I' */ && b == 0x6e /* 'n' */ && c == 0x66/* 'f' */)
        || (a == 0x49 /* 'I' */ && b == 0x4e /* 'N' */ && c == 0x46/* 'F' */)
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    // reject_nullish=false preserves YAML's coerce-undefined-to-"undefined" behavior.
    super::with_text_format_source(
        global,
        call_frame,
        b"input.yaml",
        true,
        false,
        |arena, log, source| {
            let root = match YAML::parse(source, log, arena) {
                Ok(root) => root,
                Err(YamlParseError::OutOfMemory) => return Err(JsError::OutOfMemory),
                Err(YamlParseError::StackOverflow) => return Err(global.throw_stack_overflow()),
                Err(YamlParseError::SyntaxError) => {
                    if !log.msgs.is_empty() {
                        let first_msg = &log.msgs[0];
                        let error_text = &first_msg.data.text;
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!("YAML Parse error: {}", bstr::BStr::new(error_text)),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("YAML Parse error: Unable to parse YAML string"),
                    )));
                }
            };

            let mut ctx = ParserCtx {
                seen_objects: HashMap::default(),
                stack_check: StackCheck::init(),
                global,
                root,
                result: JSValue::ZERO,
            };

            MarkedArgumentBuffer::run(&mut ctx, ParserCtx::run);

            Ok(ctx.result)
        },
    )
}

pub struct ParserCtx<'a> {
    seen_objects: HashMap<*const c_void, JSValue>,
    stack_check: StackCheck,

    global: &'a JSGlobalObject,
    root: Expr,

    result: JSValue,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ToJsError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("JSError")]
    JsError,
    #[error("JSTerminated")]
    JsTerminated,
    #[error("StackOverflow")]
    StackOverflow,
}

impl From<JsError> for ToJsError {
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => ToJsError::OutOfMemory,
            JsError::Thrown => ToJsError::JsError,
            JsError::Terminated => ToJsError::JsTerminated,
        }
    }
}

bun_core::oom_from_alloc!(ToJsError);

impl From<bun_ast::ToJSError> for ToJsError {
    fn from(e: bun_ast::ToJSError) -> Self {
        use bun_ast::ToJSError as Up;
        match e {
            Up::OutOfMemory => ToJsError::OutOfMemory,
            Up::JSError => ToJsError::JsError,
            Up::JSTerminated => ToJsError::JsTerminated,
            // `value_string_to_js` never yields the macro/identifier variants
            // (those come from the full `data_to_js` walker); map defensively.
            Up::CannotConvertArgumentTypeToJS
            | Up::CannotConvertIdentifierToJS
            | Up::MacroError => ToJsError::JsError,
        }
    }
}

impl<'a> ParserCtx<'a> {
    // deinit: seen_objects has Drop; no explicit impl needed.

    pub extern "C" fn run(ctx: *mut ParserCtx<'a>, args: *mut MarkedArgumentBuffer) {
        // SAFETY: MarkedArgumentBuffer::run passes valid non-null pointers for the duration of the call
        let ctx = unsafe { &mut *ctx };
        let args = unsafe { &mut *args };
        let root = ctx.root;
        ctx.result = match ctx.to_js(args, root) {
            Ok(v) => v,
            Err(ToJsError::OutOfMemory) => {
                ctx.result = ctx.global.throw_out_of_memory_value();
                return;
            }
            Err(ToJsError::JsError) | Err(ToJsError::JsTerminated) => {
                ctx.result = JSValue::ZERO;
                return;
            }
            Err(ToJsError::StackOverflow) => {
                let _ = ctx.global.throw_stack_overflow();
                ctx.result = JSValue::ZERO;
                return;
            }
        };
    }

    pub fn to_js(
        &mut self,
        args: &mut MarkedArgumentBuffer,
        expr: Expr,
    ) -> Result<JSValue, ToJsError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(ToJsError::StackOverflow);
        }
        match expr.data {
            ExprData::ENull(_) => Ok(JSValue::NULL),
            ExprData::EBoolean(boolean) => Ok(JSValue::from(boolean.value)),
            ExprData::ENumber(number) => Ok(JSValue::js_number(number.value)),
            ExprData::EString(str) => Ok(bun_js_parser_jsc::value_string_to_js(
                str.get(),
                self.global,
            )?),
            ExprData::EArray(e_array) => {
                let key = e_array.as_ptr().cast_const().cast::<c_void>();
                if let Some(arr) = self.seen_objects.get(&key) {
                    return Ok(*arr);
                }

                let arr =
                    JSValue::create_empty_array(self.global, e_array.items.len_u32() as usize)?;

                args.append(arr);
                self.seen_objects.put(key, arr)?;

                for (_i, item) in e_array.slice().iter().enumerate() {
                    let i: u32 = u32::try_from(_i).expect("int cast");
                    let value = self.to_js(args, *item)?;
                    arr.put_index(self.global, i, value)?;
                }

                Ok(arr)
            }
            ExprData::EObject(e_object) => {
                let key = e_object.as_ptr().cast_const().cast::<c_void>();
                if let Some(obj) = self.seen_objects.get(&key) {
                    return Ok(*obj);
                }

                let obj = JSValue::create_empty_object(
                    self.global,
                    e_object.properties.len_u32() as usize,
                );

                args.append(obj);
                self.seen_objects.put(key, obj)?;

                for prop in e_object.properties.slice() {
                    let key_expr = prop.key.expect("infallible: prop has key");
                    let value_expr = prop.value.expect("infallible: prop has value");

                    let key = self.to_js(args, key_expr)?;
                    let value = self.to_js(args, value_expr)?;

                    let key_str = OwnedString::new(key.to_bun_string(self.global)?);
                    obj.put_may_be_index(self.global, &key_str, value)?;
                }

                Ok(obj)
            }

            // unreachable. the yaml AST does not use any other
            // expr types
            _ => Ok(JSValue::UNDEFINED),
        }
    }
}

// ported from: src/runtime/api/YAMLObject.zig
