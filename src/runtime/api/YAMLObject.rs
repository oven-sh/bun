use bun_collections::VecExt;
use core::ffi::c_void;

use bun_ast::{Expr, expr::Data as ExprData};
use bun_collections::{HashMap, StringHashMap};
use bun_core::StackCheck;
use bun_core::String as BunString;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSFunction, JSPropertyIterator, JSPropertyIteratorOptions, JSValue,
    js_function::CreateJSFunctionOptions,
    JsError, JsResult, MarkedArgumentBuffer, wtf,
};
use bun_parsers::yaml::{CyclicAliases, YAML, YamlParseError};
use bun_jsc::bun_string_jsc;

#[bun_jsc::host_fn]
fn stringify(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
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

    stringifier
        .find_anchors_and_aliases(global, value, ValueOrigin::Root)
        .map_err(|err| err.to_js_error(global))?;

    stringifier
        .stringify(global, value)
        .map_err(|err| err.to_js_error(global))?;

    stringifier.builder.to_string(global)
}

struct Stringifier {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    indent: usize,

    known_collections: HashMap<JSValue, AnchorAlias>,
    array_item_counter: usize,
    prop_names: StringHashMap<usize>,

    space: Space,
}

enum Space {
    Minified,
    Number(u32),
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

pub(crate) struct AnchorAlias {
    anchored: bool,
    used: bool,
    name: AnchorAliasName,
}

impl Default for AnchorAlias {
    fn default() -> Self {
        // Exists only because `HashMap::get_or_put` requires `V: Default` to
        // fill the freshly-inserted slot; the value is immediately overwritten
        // by the caller (see `find_anchors_and_aliases`).
        AnchorAlias {
            anchored: false,
            used: false,
            name: AnchorAliasName::Root,
        }
    }
}

impl AnchorAlias {
    fn init(origin: ValueOrigin<'_>) -> AnchorAlias {
        AnchorAlias {
            anchored: false,
            used: false,
            name: match origin {
                ValueOrigin::Root => AnchorAliasName::Root,
                ValueOrigin::ArrayItem => AnchorAliasName::ArrayItem(0),
                ValueOrigin::PropValue(prop_name) => AnchorAliasName::PropValue {
                    prop_name: (*prop_name).clone(),
                    counter: 0,
                },
            },
        }
    }
}

pub(crate) enum AnchorAliasName {
    // only one root anchor is possible
    Root,
    ArrayItem(usize),
    PropValue {
        prop_name: BunString,
        // added after the name
        counter: usize,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum ValueOrigin<'a> {
    Root,
    ArrayItem,
    PropValue(&'a BunString),
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub(crate) enum StringifyError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("JSError")]
    JsError,
    #[error("StackOverflow")]
    StackOverflow,
}

impl From<JsError> for StringifyError {
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => StringifyError::OutOfMemory,
            JsError::Thrown | JsError::Terminated => StringifyError::JsError,
        }
    }
}

impl StringifyError {
    /// `OutOfMemory` and `JsError` are already JS-shaped (the host-fn wrapper
    /// throws the former, the latter's exception is pending); only
    /// `StackOverflow` still has to be thrown here.
    #[cold]
    fn to_js_error(self, global: &JSGlobalObject) -> JsError {
        match self {
            StringifyError::OutOfMemory => JsError::OutOfMemory,
            StringifyError::JsError => JsError::Thrown,
            StringifyError::StackOverflow => global.throw_stack_overflow(),
        }
    }
}

bun_core::oom_from_alloc!(StringifyError);

impl Stringifier {
    fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Stringifier> {
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

    fn find_anchors_and_aliases(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
        origin: ValueOrigin<'_>,
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
                    // Unsafe names use generated `value<counter>` anchors, keyed on
                    // "value" so the counter is shared with literal "value" properties.
                    let key: &[u8] = if can_use_prop_name_as_anchor(prop_name) {
                        prop_name.byte_slice()
                    } else {
                        b"value"
                    };
                    let name_entry = self.prop_names.get_or_put(key)?;
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
        let iter = JSPropertyIterator::init(
            global,
            unwrapped.to_object(global)?,
            JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;

        while let Some((prop_name, value)) = iter.next()? {
            if value.is_undefined() || value.is_symbol() || value.is_function() {
                continue;
            }
            self.find_anchors_and_aliases(global, value, ValueOrigin::PropValue(&prop_name))?;
        }

        Ok(())
    }

    fn stringify(&mut self, global: &JSGlobalObject, value: JSValue) -> Result<(), StringifyError> {
        let unwrapped = value.unwrap_boxed_primitive(global)?;
        self.stringify_unwrapped(global, unwrapped)
    }

    /// `unwrapped` has been through `unwrap_boxed_primitive`.
    fn stringify_unwrapped(
        &mut self,
        global: &JSGlobalObject,
        unwrapped: JSValue,
    ) -> Result<(), StringifyError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }

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
            let value_str = unwrapped.to_bun_string(global)?;
            self.append_string(&value_str);
            return Ok(());
        }

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
                    if !can_use_prop_name_as_anchor(prop_name) {
                        self.builder.append_latin1(b"value");
                        self.builder.append_usize(*counter);
                    } else {
                        self.builder.append_string(prop_name);
                        if *counter != 0 {
                            self.builder.append_usize(*counter);
                        }
                    }
                }
            }

            if anchor.anchored {
                return Ok(());
            }

            // `anchored` is set before `newline()` (the order is irrelevant to
            // output; doing it here releases the `anchor` borrow first).
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
        let iter = JSPropertyIterator::init(
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
                while let Some((prop_name, value)) = iter.next()? {
                    if value.is_undefined() || value.is_symbol() || value.is_function() {
                        continue;
                    }

                    if !first {
                        self.builder.append_lchar(b',');
                    }
                    first = false;

                    self.append_string(&prop_name);
                    self.builder.append_latin1(b": ");

                    self.stringify(global, value)?;
                }
                self.builder.append_lchar(b'}');
            }
            Space::Number(_) | Space::Str(_) => {
                self.builder.ensure_unused_capacity(iter.len * b": ".len());

                let mut first = true;
                while let Some((prop_name, value)) = iter.next()? {
                    if value.is_undefined() || value.is_symbol() || value.is_function() {
                        continue;
                    }

                    if !first {
                        self.newline();
                    }
                    first = false;

                    self.append_string(&prop_name);
                    self.builder.append_latin1(b": ");

                    self.indent += 1;

                    let prop_value = value.unwrap_boxed_primitive(global)?;
                    if prop_value_needs_newline(prop_value) {
                        self.newline();
                    }

                    self.stringify_unwrapped(global, prop_value)?;
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

                let clamped = space_str.trunc(10);

                self.builder
                    .ensure_unused_capacity(indent_count * clamped.length());
                for _ in 0..indent_count {
                    self.builder.append_string(&clamped);
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
                0x2028 => self.builder.append_latin1(b"\\L"), // line separator
                0x2029 => self.builder.append_latin1(b"\\P"), // paragraph separator

                0x20..=0x21
                | 0x23..=0x5b
                | 0x5d..=0x7e
                | 0x80..=0x84
                | 0x86..=0x9f
                | 0xa1..=0x2027
                | 0x202a..=u16::MAX => self.builder.append_uchar(c),
            }
        }

        self.builder.append_lchar(b'"');
    }

    fn append_string(&mut self, str: &BunString) {
        if string_needs_quotes(str) {
            self.append_double_quoted_string(str);
            return;
        }
        self.builder.append_string(str);
    }
}

/// Does this (unwrapped) object property value need a newline? True for arrays and objects.
fn prop_value_needs_newline(value: JSValue) -> bool {
    !value.is_number() && !value.is_boolean() && !value.is_null() && !value.is_string()
}

/// Can this property name be emitted verbatim as an anchor/alias name?
/// Anchor names can't be quoted or escaped, so only unambiguously safe characters
/// are reused; anything else falls back to a generated `value<counter>` name.
fn can_use_prop_name_as_anchor(str: &BunString) -> bool {
    if str.is_empty() {
        return false;
    }

    for i in 0..str.length() {
        match str.char_at(i) {
            0x30..=0x39 /* '0'..='9' */
            | 0x41..=0x5a /* 'A'..='Z' */
            | 0x61..=0x7a /* 'a'..='z' */
            | 0x2d /* '-' */
            | 0x2e /* '.' */
            | 0x5f /* '_' */ => {}
            _ => return false,
        }
    }

    !matches_generated_anchor_name(str)
}

/// `value0`, `item12`, `root1`, ... — names that could duplicate a generated anchor name.
fn matches_generated_anchor_name(str: &BunString) -> bool {
    const PREFIXES: [&[u8]; 3] = [b"value", b"item", b"root"];

    'next_prefix: for prefix in PREFIXES {
        if str.length() <= prefix.len() {
            continue;
        }

        for (i, &byte) in prefix.iter().enumerate() {
            if str.char_at(i) != u16::from(byte) {
                continue 'next_prefix;
            }
        }

        for i in prefix.len()..str.length() {
            if !matches!(str.char_at(i), 0x30..=0x39 /* '0'..='9' */) {
                continue 'next_prefix;
            }
        }

        return true;
    }

    false
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
        if str.eq_ascii(keyword) {
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
            | 0x2028
            | 0x2029 => return true,

            _ => {
                i += 1;
            }
        }
    }

    false
}

/// Returns true when `str` would be parsed back as a number by `YAML.parse`.
///
/// This mirrors the rules in `src/parsers/yaml.rs`'s `try_resolve_number` /
/// `is_core_schema_number`:
/// - Optional leading sign, optionally followed by `.inf`/`.Inf`/`.INF`.
/// - Otherwise either an integer (`[0-9]+` / `0x…` / `0o…`) or a float
///   matching §10.2.1.4 `[-+]? ( . [0-9]+ | [0-9]+ ( . [0-9]* )? ) ([eE][-+]?[0-9]+)?`.
///   The parser-side gate now rejects non-conforming float-like tokens
///   (e.g. `"1+5"`, `"1e"`, `"."`) so this mirror should err on the side of
///   *quoting* whenever a token *might* parse as a number.
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
pub(crate) fn parse(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    // `Bun.YAML.parse(str, { uniqueKeys?: boolean })` — `uniqueKeys` mirrors
    // yaml@2's `parseDocument` opt-in. Default `false` keeps last-wins
    // semantics to match js-yaml and yaml@2 defaults.
    let args = call_frame.arguments();
    let unique_keys = if args.len() > 1 && args[1].is_object() {
        args[1]
            .get(global, b"uniqueKeys")?
            .map(|v| v.as_boolean())
            .unwrap_or(false)
    } else {
        false
    };

    // `NullishInput::ToString` preserves YAML's coerce-undefined-to-"undefined" behavior.
    super::with_text_format_source(
        global,
        call_frame,
        b"input.yaml",
        super::BlobOrBufferInput::Bytes,
        super::NullishInput::ToString,
        |arena, log, source| {
            // `ParserCtx::to_js` materializes each `E::Array`/`E::Object`
            // once by pointer identity, so a cyclic graph is fine here.
            let root =
                match YAML::parse(source, log, arena, CyclicAliases::Allow, unique_keys) {
                Ok(root) => root,
                Err(YamlParseError::OutOfMemory) => return Err(JsError::OutOfMemory),
                Err(YamlParseError::StackOverflow) => return Err(global.throw_stack_overflow()),
                Err(YamlParseError::SyntaxError) => {
                    if !log.msgs.is_empty() {
                        let first_msg = &log.msgs[0];
                        let error_text = &first_msg.data.text;
                        let msg = if let Some(loc) = &first_msg.data.location {
                            // `Location.line` is 1-based; `Location.column` is 0-based
                            // bytes — the same coordinate js-yaml's `linePos` and
                            // `yaml@2`'s `parseDocument` positional errors expose,
                            // so downstream consumers (credentials-local config
                            // validation) get identical line/column on failure.
                            if loc.line > 0 {
                                format_args!(
                                    "YAML Parse error: {} (line {}, column {})",
                                    bstr::BStr::new(error_text),
                                    loc.line,
                                    loc.column,
                                )
                            } else {
                                format_args!("YAML Parse error: {}", bstr::BStr::new(error_text))
                            }
                        } else {
                            format_args!("YAML Parse error: {}", bstr::BStr::new(error_text))
                        };
                        return Err(global.throw_value(global.create_syntax_error_instance(msg)));
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

struct ParserCtx<'a> {
    seen_objects: HashMap<*const c_void, JSValue>,
    stack_check: StackCheck,

    global: &'a JSGlobalObject,
    root: Expr,

    result: JSValue,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub(crate) enum ToJsError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("JSError")]
    JsError,
    #[error("StackOverflow")]
    StackOverflow,
}

impl From<JsError> for ToJsError {
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => ToJsError::OutOfMemory,
            JsError::Thrown | JsError::Terminated => ToJsError::JsError,
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
            // `value_string_to_js` never yields these; map defensively.
            Up::CannotConvertArgumentTypeToJS | Up::CannotConvertIdentifierToJS => {
                ToJsError::JsError
            }
        }
    }
}

impl<'a> ParserCtx<'a> {
    // deinit: seen_objects has Drop; no explicit impl needed.

    extern "C" fn run(ctx: *mut ParserCtx<'a>, args: *mut MarkedArgumentBuffer) {
        // SAFETY: MarkedArgumentBuffer::run passes valid non-null pointers for the duration of the call
        let (ctx, args) = unsafe { (&mut *ctx, &mut *args) };
        let root = ctx.root;
        ctx.result = match ctx.to_js(args, root) {
            Ok(v) => v,
            Err(ToJsError::OutOfMemory) => {
                ctx.result = ctx.global.throw_out_of_memory_value();
                return;
            }
            Err(ToJsError::JsError) => {
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

    fn to_js(&mut self, args: &mut MarkedArgumentBuffer, expr: Expr) -> Result<JSValue, ToJsError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(ToJsError::StackOverflow);
        }
        match expr.data {
            ExprData::ENull(_) => Ok(JSValue::NULL),
            ExprData::EBoolean(boolean) => Ok(JSValue::from(boolean.value)),
            ExprData::ENumber(number) => Ok(JSValue::js_number(number.value())),
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

                    let key_str = key.to_bun_string(self.global)?;
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

// ───────────────────────────────────────────────────────────────────────────
// Bun.YAML.Document — comment-preserving YAML document. Mirrors yaml@2's
// Document API (parseDocument / toJS / toString / setIn / deleteIn /
// comment) for use by credentials-local and settings-file write paths.

/// Private data slot key on every Document instance. A non-enumerable
/// string property (not a Symbol) so `for...in` and `Object.keys` skip it
/// but `Object.hasOwn`/direct access work.
const DOC_STORAGE_KEY: &[u8] = b"\0Bun.YAML.Document";

/// Extract the byte offset from a `Pos`. `Pos` is `#[repr(transparent)]`
/// over `usize`, so transmutation is layout-identical and safe.
#[inline]
fn pos_to_usize(pos: bun_parsers::yaml::Pos) -> usize {
    // SAFETY: Pos is #[repr(transparent)] newtype over usize.
    unsafe { std::mem::transmute(pos) }
}

/// Parse a path segment as a u32 array index, rejecting non-numeric
/// segments. `bun_string_to_u32` silently returns 0 for garbage, which
/// would make `setIn(["list", "name"], v)` overwrite element 0.
fn path_index(global: &JSGlobalObject, key: &BunString) -> JsResult<u32> {
    match std::str::from_utf8(key.to_utf8().slice())
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
    {
        Some(idx) => Ok(idx),
        None => Err(global.throw_invalid_arguments(format_args!(
            "YAML.Document: array index must be a non-negative integer"
        ))),
    }
}

/// Fetch the private data slot from a Document instance, or throw.
fn doc_storage_of(global: &JSGlobalObject, this: JSValue) -> JsResult<JSValue> {
    match this.get(global, DOC_STORAGE_KEY)? {
        Some(v) => Ok(v),
        None => Err(global.throw_type_error(format_args!(
            "this is not a Bun.YAML.Document"
        ))),
    }
}

/// Create a fresh storage object: `{ value, comments: [] }`.
fn make_doc_storage(
    global: &JSGlobalObject,
    value: JSValue,
    comments: Vec<Vec<u8>>,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 3);
    obj.put(global, b"value", value);
    let arr = JSValue::create_empty_array(global, comments.len())?;
    for (i, c) in comments.iter().enumerate() {
        arr.put_index(
            global,
            i as u32,
            bun_string_jsc::create_utf8_for_js(global, c)?,
        )?;
    }
    obj.put(global, b"comments", arr);
    Ok(obj)
}

/// Update the `value` slot of an existing storage object.
fn update_doc_value(global: &JSGlobalObject, storage: JSValue, value: JSValue) -> JsResult<()> {
    storage.put(global, b"value", value);
    Ok(())
}

/// Read the `value` slot from storage.
fn read_doc_value(global: &JSGlobalObject, storage: JSValue) -> JsResult<JSValue> {
    // `JSValue::get` returns `None` for both missing properties AND
    // properties holding `undefined` (JSC treats them identically at the C
    // API level). Use `UNDEFINED` as the fallback so we don't collapse
    // `undefined` into `null`.
    let v = storage.get(global, b"value")?.unwrap_or(JSValue::UNDEFINED);
    Ok(v)
}

/// Read the `comments` slot from storage. Returns Vec<Vec<u8>> (raw UTF-8 bytes).
fn read_doc_comments(global: &JSGlobalObject, storage: JSValue) -> JsResult<Vec<Vec<u8>>> {
    let cmt = storage.get(global, b"comments")?;
    let Some(arr) = cmt else {
        return Ok(Vec::new());
    };
    let len = arr.get_length(global)? as usize;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let v = arr.get_index(global, i as u32)?;
        if v.is_string() {
            let bs = v.to_bun_string(global)?;
            out.push(bs.to_utf8().into_vec());
        }
    }
    Ok(out)
}

/// Update the `comments` slot with a new array.
fn update_doc_comments(
    global: &JSGlobalObject,
    storage: JSValue,
    comments: &[Vec<u8>],
) -> JsResult<()> {
    let arr = JSValue::create_empty_array(global, comments.len())?;
    for (i, c) in comments.iter().enumerate() {
        arr.put_index(
            global,
            i as u32,
            bun_string_jsc::create_utf8_for_js(global, c)?,
        )?;
    }
    storage.put(global, b"comments", arr);
    Ok(())
}

/// Slice comment text out of the raw source bytes using each comment's
/// start/end byte offsets. Returns Vec<Vec<u8>> (one per comment, UTF-8 bytes
/// including the leading `#`).
fn collect_comments(source_bytes: &[u8], parsed: &bun_parsers::yaml::ParsedYaml) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    for doc in &parsed.docs {
        for c in &doc.comments {
            let start = pos_to_usize(c.start);
            let end = pos_to_usize(c.end);
            if start < source_bytes.len() && end <= source_bytes.len() && start < end {
                // Only the comment text itself, from `#` through the end of
                // the comment — not the whole line leading up to it.
                out.push(source_bytes[start..end].to_vec());
            }
        }
    }
    out
}

#[bun_jsc::host_fn]
pub(crate) fn parse_document(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let args = call_frame.arguments();
    let input = if args.len() > 0 { args[0] } else { JSValue::UNDEFINED };
    let yaml_ns = call_frame.this();

    if input.is_null() {
        let storage = make_doc_storage(global, JSValue::NULL, Vec::new())?;
        return create_doc_instance(global, yaml_ns, storage);
    }
    if input.is_undefined() {
        let storage = make_doc_storage(global, JSValue::UNDEFINED, Vec::new())?;
        return create_doc_instance(global, yaml_ns, storage);
    }
    if !input.is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "YAML.parseDocument: expected a string"
        )));
    }

    let unique_keys = if args.len() > 1 && args[1].is_object() {
        args[1]
            .get(global, b"uniqueKeys")
            .ok()
            .flatten()
            .map(|v| v.as_boolean())
            .unwrap_or(false)
    } else {
        false
    };

    super::with_text_format_source(
        global,
        call_frame,
        b"input.yaml",
        super::BlobOrBufferInput::Bytes,
        super::NullishInput::ToString,
        |arena, log, source| {
            let source_bytes = source.contents();

            let parsed = match YAML::parse_with_comments(
                source,
                log,
                arena,
                CyclicAliases::Allow,
                unique_keys,
            ) {
                Ok(p) => p,
                Err(YamlParseError::OutOfMemory) => return Err(JsError::OutOfMemory),
                Err(YamlParseError::StackOverflow) => return Err(global.throw_stack_overflow()),
                Err(YamlParseError::SyntaxError) => {
                    if !log.msgs.is_empty() {
                        let first_msg = &log.msgs[0];
                        let error_text = &first_msg.data.text;
                        let msg = if let Some(loc) = &first_msg.data.location {
                            if loc.line > 0 {
                                format_args!(
                                    "YAML Parse error: {} (line {}, column {})",
                                    bstr::BStr::new(error_text),
                                    loc.line,
                                    loc.column,
                                )
                            } else {
                                format_args!("YAML Parse error: {}", bstr::BStr::new(error_text))
                            }
                        } else {
                            format_args!("YAML Parse error: {}", bstr::BStr::new(error_text))
                        };
                        return Err(global.throw_value(global.create_syntax_error_instance(msg)));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("YAML Parse error: Unable to parse YAML string"),
                    )));
                }
            };

            let root = parsed.root;
            let mut ctx = ParserCtx {
                seen_objects: HashMap::default(),
                stack_check: StackCheck::init(),
                global,
                root,
                result: JSValue::ZERO,
            };
            MarkedArgumentBuffer::run(&mut ctx, ParserCtx::run);
            let value = ctx.result;

            let comments = collect_comments(source_bytes, &parsed);

            let storage = make_doc_storage(global, value, comments)?;
            create_doc_instance(global, yaml_ns, storage)
        },
    )
}

/// Create a Document instance with the given storage, attaching
/// `Document.prototype` so instance methods (`toJS`, `toString`, etc.) are
/// inherited.
///
/// `yaml_ns` is normally `Bun.YAML` (the `this` of `parseDocument`), but a
/// destructured call (`const { parseDocument } = Bun.YAML; parseDocument(s)`)
/// makes `this` undefined — fall back to the global lookup so the prototype
/// methods are still attached instead of silently returning a bare object.
fn create_doc_instance(
    global: &JSGlobalObject,
    yaml_ns: JSValue,
    storage: JSValue,
) -> JsResult<JSValue> {
    let ns = if yaml_ns.is_object() {
        yaml_ns
    } else {
        get_yaml_ns_from_global(global)?
    };
    let document_fn = match ns.get(global, b"Document")? {
        Some(v) => v,
        None => return bare_doc_instance(global, storage),
    };
    create_doc_instance_from_ctor(global, document_fn, storage)
}

/// A Document without `Document.prototype` methods — the graceful fallback
/// when the constructor cannot be resolved.
fn bare_doc_instance(global: &JSGlobalObject, storage: JSValue) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 0);
    obj.put_non_enumerable(global, DOC_STORAGE_KEY, storage);
    Ok(obj)
}

/// Build a Document instance using `Object.create(ctor.prototype)`.
/// `ctor` is the Document constructor function.
fn create_doc_instance_from_ctor(
    global: &JSGlobalObject,
    ctor: JSValue,
    storage: JSValue,
) -> JsResult<JSValue> {
    let proto_val = match ctor.get(global, b"prototype")? {
        Some(v) => v,
        None => return bare_doc_instance(global, storage),
    };
    let object_ctor = match global.to_js_value().get(global, b"Object")? {
        Some(v) => v,
        None => return bare_doc_instance(global, storage),
    };
    let object_create = match object_ctor.get(global, b"create")? {
        Some(v) => v,
        None => return bare_doc_instance(global, storage),
    };

    let obj = object_create.call(global, object_ctor, &[proto_val])?;
    obj.put_non_enumerable(global, DOC_STORAGE_KEY, storage);
    Ok(obj)
}

#[bun_jsc::host_fn]
fn doc_to_js(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let this = call_frame.this();
    let storage = doc_storage_of(global, this)?;
    read_doc_value(global, storage)
}

#[bun_jsc::host_fn]
fn doc_to_string(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let this = call_frame.this();
    let storage = doc_storage_of(global, this)?;
    let value = read_doc_value(global, storage)?;

    let space_value = if call_frame.arguments().len() > 0 {
        call_frame.arguments()[0]
    } else {
        JSValue::from(2u32)
    };

    // Empty document: value is null or undefined. Return just a trailing newline.
    if value.is_null() || value.is_undefined() {
        let mut sb = bun_jsc::StringBuilder::init();
        sb.append_lchar(b'\n');
        return sb.to_string(global);
    }

    let mut stringifier = Stringifier::init(global, space_value)?;
    stringifier
        .find_anchors_and_aliases(global, value, ValueOrigin::Root)
        .map_err(|e| e.to_js_error(global))?;
    stringifier
        .stringify(global, value)
        .map_err(|e| e.to_js_error(global))?;

    let comments = read_doc_comments(global, storage)?;
    let mut first = true;
    for c in comments {
        if !first {
            stringifier.builder.append_lchar(b'\n');
        }
        first = false;
        // Append via the UTF-16-capable path so non-ASCII comment text
        // survives round-trips (append_latin1 would misread UTF-8 bytes).
        let cstr = BunString::from_bytes(&c);
        stringifier.builder.append_string(&cstr);
    }

    stringifier.builder.append_lchar(b'\n');
    stringifier.builder.to_string(global)
}

#[bun_jsc::host_fn]
fn doc_set_in(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let this = call_frame.this();
    let storage = doc_storage_of(global, this)?;
    let args = call_frame.arguments();
    if args.len() < 2 {
        return Err(global.throw_invalid_arguments(format_args!(
            "YAML.Document.setIn: expected path and value"
        )));
    }
    let path_val = args[0];
    let new_value = args[1];

    let path = resolve_path(global, &path_val)?;
    if path.is_empty() {
        return Ok(this);
    }

    let value = read_doc_value(global, storage)?;
    let unwrapped = value.unwrap_boxed_primitive(global)?;
    let result = set_in_impl(global, unwrapped, &path, new_value)?;
    update_doc_value(global, storage, result)?;
    Ok(this)
}

fn resolve_path(global: &JSGlobalObject, path_val: &JSValue) -> JsResult<Vec<BunString>> {
    if path_val.is_array() {
        let len = path_val.get_length(global)? as usize;
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            let item = path_val.get_index(global, i as u32)?;
            if !item.is_undefined_or_null() {
                out.push(item.to_bun_string(global)?);
            }
        }
        return Ok(out);
    }
    let s = path_val.to_bun_string(global)?;
    let bytes = s.to_utf8().into_vec();
    let mut out = Vec::new();
    let mut start = 0usize;
    for i in 0..bytes.len() {
        if bytes[i] == b'.' {
            if i > start {
                out.push(BunString::clone_utf8(&bytes[start..i]));
            }
            start = i + 1;
        }
    }
    if start < bytes.len() {
        out.push(BunString::clone_utf8(&bytes[start..bytes.len()]));
    }
    Ok(out)
}

fn set_in_impl(
    global: &JSGlobalObject,
    current: JSValue,
    path: &[BunString],
    value: JSValue,
) -> JsResult<JSValue> {
    let unwrapped = current.unwrap_boxed_primitive(global)?;

    if path.len() == 1 {
        let key = &path[0];
        if unwrapped.is_object() {
            if unwrapped.is_array() {
                let idx = path_index(global, key)?;
                unwrapped.put_index(global, idx, value)?;
            } else {
                unwrapped.put_may_be_index(global, key, value)?;
            }
            return Ok(unwrapped);
        }
        let new_obj = JSValue::create_empty_object(global, 1);
        new_obj.put_may_be_index(global, key, value)?;
        return Ok(new_obj);
    }

    let next_key = &path[0];
    let rest = &path[1..];

    if unwrapped.is_object() {
        if unwrapped.is_array() {
            let idx = path_index(global, next_key)?;
            let existing = unwrapped.get_index(global, idx)?;
            let child = set_in_impl(global, existing, rest, value)?;
            unwrapped.put_index(global, idx, child)?;
            return Ok(unwrapped);
        } else {
            let existing = unwrapped
                .get(global, next_key.to_utf8().into_vec())?
                .unwrap_or(JSValue::UNDEFINED);
            let child = set_in_impl(global, existing, rest, value)?;
            unwrapped.put_may_be_index(global, next_key, child)?;
            return Ok(unwrapped);
        }
    }

    let new_obj = JSValue::create_empty_object(global, 1);
    let child = set_in_impl(global, JSValue::UNDEFINED, rest, value)?;
    new_obj.put_may_be_index(global, next_key, child)?;
    Ok(new_obj)
}

#[bun_jsc::host_fn]
fn doc_delete_in(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let this = call_frame.this();
    let storage = doc_storage_of(global, this)?;
    let args = call_frame.arguments();
    if args.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "YAML.Document.deleteIn: expected path"
        )));
    }
    let path_val = args[0];

    let path = resolve_path(global, &path_val)?;
    if path.is_empty() {
        return Ok(this);
    }

    let value = read_doc_value(global, storage)?;
    let unwrapped = value.unwrap_boxed_primitive(global)?;
    let result = delete_in_impl(global, unwrapped, &path)?;
    update_doc_value(global, storage, result)?;
    Ok(this)
}

fn delete_in_impl(
    global: &JSGlobalObject,
    current: JSValue,
    path: &[BunString],
) -> JsResult<JSValue> {
    let unwrapped = current.unwrap_boxed_primitive(global)?;

    if path.len() == 1 {
        let key = &path[0];
        if unwrapped.is_object() {
            if unwrapped.is_array() {
                let idx = path_index(global, key)?;
                unwrapped.put_index(global, idx, JSValue::UNDEFINED)?;
            } else {
                unwrapped
                    .delete_property(global, key.to_utf8().into_vec())?;
            }
            return Ok(unwrapped);
        }
        // No deletion applied (primitive at the path): return the node
        // unchanged so the caller does not write back `undefined`.
        return Ok(unwrapped);
    }

    let next_key = &path[0];
    let rest = &path[1..];

    if !unwrapped.is_object() {
        return Ok(unwrapped);
    }

    if unwrapped.is_array() {
        let idx = path_index(global, next_key)?;
        let existing = unwrapped.get_index(global, idx)?;
        let child = delete_in_impl(global, existing, rest)?;
        if child.is_undefined() {
            unwrapped.put_index(global, idx, JSValue::UNDEFINED)?;
        } else {
            unwrapped.put_index(global, idx, child)?;
        }
        return Ok(unwrapped);
    }

    let existing = unwrapped
        .get(global, next_key.to_utf8().into_vec())?
        .unwrap_or(JSValue::UNDEFINED);
    let child = delete_in_impl(global, existing, rest)?;
    if child.is_undefined() {
        unwrapped.delete_property(global, next_key.to_utf8().into_vec())?;
    } else {
        unwrapped.put_may_be_index(global, next_key, child)?;
    }
    Ok(unwrapped)
}

#[bun_jsc::host_fn]
fn doc_comment(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let this = call_frame.this();
    let storage = doc_storage_of(global, this)?;
    let args = call_frame.arguments();
    if args.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "YAML.Document.comment: expected text"
        )));
    }
    let text_val = args[0];

    let text = text_val.to_bun_string(global)?;
    // `to_utf8` keeps non-ASCII comment characters intact (the previous
    // ASCII-only filter silently dropped them).
    let cmt = text.to_utf8().into_vec();

    let cmt_str = if cmt.first() == Some(&b'#') {
        if cmt.len() > 1 && cmt[1] == b' ' {
            cmt
        } else {
            let mut v = Vec::with_capacity(cmt.len() + 1);
            v.extend_from_slice(b"# ");
            v.extend_from_slice(&cmt[1..]);
            v
        }
    } else {
        let mut v = Vec::with_capacity(cmt.len() + 2);
        v.extend_from_slice(b"# ");
        v.extend_from_slice(&cmt);
        v
    };

    let mut comments = read_doc_comments(global, storage)?;
    comments.push(cmt_str);
    update_doc_comments(global, storage, &comments)?;
    Ok(this)
}

#[bun_jsc::host_fn]
fn doc_construct(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let args = call_frame.arguments();
    let value = if args.len() > 0 { args[0] } else { JSValue::NULL };
    let storage = make_doc_storage(global, value, Vec::new())?;

    // `call_frame.this()` is a freshly-created empty object (JSC's
    // callHostFunctionAsConstructor) with no access to the Document
    // constructor or YAML namespace. Retrieve the YAML namespace from the
    // global scope (Bun.YAML) to look up Document.prototype.
    let yaml_ns = get_yaml_ns_from_global(global)?;
    create_doc_instance(global, yaml_ns, storage)
}

/// Look up the `Bun.YAML` namespace from the global scope.
fn get_yaml_ns_from_global(global: &JSGlobalObject) -> JsResult<JSValue> {
    match global.to_js_value().get(global, b"Bun")? {
        Some(bun) => match bun.get(global, b"YAML")? {
            Some(v) => Ok(v),
            None => Ok(JSValue::UNDEFINED),
        },
        None => Ok(JSValue::UNDEFINED),
    }
}

/// Register the Document constructor + prototype on the YAML namespace.
pub(crate) fn register_doc_class(global: &JSGlobalObject, yaml_obj: JSValue) -> JsResult<()> {
    let proto = JSValue::create_empty_object(global, 5);
    // Methods go on the prototype non-enumerably, like class members —
    // `for...in` over a Document must not list them.
    proto.put_non_enumerable(
        global,
        b"toJS",
        JSFunction::create(global, "toJS", __jsc_host_doc_to_js, 0, Default::default()),
    );
    proto.put_non_enumerable(
        global,
        b"toString",
        JSFunction::create(global, "toString", __jsc_host_doc_to_string, 1, Default::default()),
    );
    proto.put_non_enumerable(
        global,
        b"setIn",
        JSFunction::create(global, "setIn", __jsc_host_doc_set_in, 2, Default::default()),
    );
    proto.put_non_enumerable(
        global,
        b"deleteIn",
        JSFunction::create(global, "deleteIn", __jsc_host_doc_delete_in, 1, Default::default()),
    );
    proto.put_non_enumerable(
        global,
        b"comment",
        JSFunction::create(global, "comment", __jsc_host_doc_comment, 1, Default::default()),
    );

    let constructor = JSFunction::create(
        global,
        "Document",
        __jsc_host_doc_construct,
        1,
        CreateJSFunctionOptions {
            constructor: Some(__jsc_host_doc_construct),
            ..Default::default()
        },
    );
    constructor.put(global, b"prototype", proto);
    yaml_obj.put(global, b"Document", constructor);

    Ok(())
}

pub(crate) fn create(global_this: &JSGlobalObject) -> JSValue {
    let yaml_obj = jsc::create_host_function_object(
        global_this,
        &[
            ("parse", __jsc_host_parse, 1),
            ("stringify", __jsc_host_stringify, 3),
            ("parseDocument", __jsc_host_parse_document, 1),
        ],
    );
    if let Err(err) = register_doc_class(global_this, yaml_obj) {
        // A failed registration (e.g. OOM) must not silently leave a
        // namespace whose parseDocument returns prototype-less objects;
        // surface it as a pending exception instead.
        let js_err = match err {
            JsError::Thrown => global_this.take_exception(JsError::Thrown),
            _ => global_this.create_out_of_memory_error(),
        };
        global_this.throw_value(js_err);
    }
    yaml_obj
}
