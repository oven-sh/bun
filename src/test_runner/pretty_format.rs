use core::cell::RefCell;
use core::ffi::c_void;
use bun_io::Write as _;

use bun_collections::HashMap;
use bun_core::{fmt as bun_fmt, Output};
use bun_jsc::{
    self as jsc, c_api as CAPI, CallFrame, JSGlobalObject, JSObject, JSPropertyIterator, JSType,
    JSValue, JsError, JsResult, VM,
};
use bun_js_parser::js_lexer as JSLexer;
use bun_str::{strings, ZigString};

use crate::expect;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum EventType {
    Event,
    MessageEvent,
    CloseEvent,
    ErrorEvent,
    OpenEvent,
    Unknown = 254,
    // TODO(port): Zig non-exhaustive enum (`_`); other values are valid u8.
}

impl EventType {
    pub const MAP: phf::Map<&'static [u8], EventType> = phf::phf_map! {
        b"event" => EventType::Event,
        b"message" => EventType::MessageEvent,
        b"close" => EventType::CloseEvent,
        b"error" => EventType::ErrorEvent,
        b"open" => EventType::OpenEvent,
    };

    pub fn label(self) -> &'static [u8] {
        match self {
            Self::Event => b"event",
            Self::MessageEvent => b"message",
            Self::CloseEvent => b"close",
            Self::ErrorEvent => b"error",
            Self::OpenEvent => b"open",
            _ => b"event",
        }
    }
}

pub struct JestPrettyFormat {
    pub counts: Counter,
}

pub type Type = *mut c_void;
type Counter = HashMap<u64, u32>;

impl Default for JestPrettyFormat {
    fn default() -> Self {
        Self { counts: Counter::default() }
    }
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum MessageLevel {
    Log = 0,
    Warning = 1,
    Error = 2,
    Debug = 3,
    Info = 4,
    // TODO(port): Zig non-exhaustive enum (`_`).
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum MessageType {
    Log = 0,
    Dir = 1,
    DirXML = 2,
    Table = 3,
    Trace = 4,
    StartGroup = 5,
    StartGroupCollapsed = 6,
    EndGroup = 7,
    Clear = 8,
    Assert = 9,
    Timing = 10,
    Profile = 11,
    ProfileEnd = 12,
    Image = 13,
    // TODO(port): Zig non-exhaustive enum (`_`).
}

#[derive(Copy, Clone)]
pub struct FormatOptions {
    pub enable_colors: bool,
    pub add_newline: bool,
    pub flush: bool,
    pub quote_strings: bool,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self { enable_colors: false, add_newline: false, flush: false, quote_strings: false }
    }
}

impl JestPrettyFormat {
    pub fn format<W: bun_io::Write>(
        level: MessageLevel,
        global: &JSGlobalObject,
        vals: &[JSValue],
        len: usize,
        writer: &mut W,
        options: FormatOptions,
    ) -> JsResult<()> {
        let mut fmt: Formatter;
        // Zig: defer { if (fmt.map_node) |node| { node.data = fmt.map; node.data.clearRetainingCapacity(); node.release(); } }
        // The pool node is acquired lazily inside print_as (Visited::Pool::get). Release it here.
        let _guard = scopeguard::guard((), |()| {
            if let Some(node) = fmt.map_node {
                // SAFETY: node points to a live pool entry acquired via visited::Pool::get.
                let node = unsafe { node.as_mut() };
                node.data = core::mem::take(&mut fmt.map);
                node.data.clear();
                node.release();
            }
        });
        // TODO(port): scopeguard borrows `fmt` across its lifetime; Phase B should make
        // visited::Pool::get() return an RAII guard so this defer becomes implicit.

        if len == 1 {
            fmt = Formatter {
                remaining_values: &[],
                global_this: global,
                quote_strings: options.quote_strings,
                ..Formatter::new(global)
            };
            let tag = Tag::get(vals[0], global)?;

            if tag.tag == Tag::String {
                if options.enable_colors {
                    if level == MessageLevel::Error {
                        let _ = writer.write_all(Output::pretty_fmt::<true>("<r><red>"));
                    }
                    fmt.format::<W, true>(tag, writer, vals[0], global)?;
                    if level == MessageLevel::Error {
                        let _ = writer.write_all(Output::pretty_fmt::<true>("<r>"));
                    }
                } else {
                    fmt.format::<W, false>(tag, writer, vals[0], global)?;
                }
                if options.add_newline {
                    let _ = writer.write_all(b"\n");
                }
            } else {
                // PORT NOTE: defer { if (options.flush) writer.flush() } — handled below
                if options.enable_colors {
                    fmt.format::<W, true>(tag, writer, vals[0], global)?;
                } else {
                    fmt.format::<W, false>(tag, writer, vals[0], global)?;
                }
                if options.add_newline {
                    let _ = writer.write_all(b"\n");
                }
                if options.flush {
                    let _ = writer.flush();
                }
            }

            let _ = writer.flush();
            return Ok(());
        }

        // PORT NOTE: defer { if (options.flush) writer.flush() } — handled at fn end

        let mut this_value: JSValue = vals[0];
        fmt = Formatter {
            remaining_values: &vals[..len][1..],
            global_this: global,
            quote_strings: options.quote_strings,
            ..Formatter::new(global)
        };
        let mut tag: TagResult;

        let mut any = false;
        if options.enable_colors {
            if level == MessageLevel::Error {
                let _ = writer.write_all(Output::pretty_fmt::<true>("<r><red>"));
            }
            loop {
                if any {
                    let _ = writer.write_all(b" ");
                }
                any = true;

                tag = Tag::get(this_value, global)?;
                if tag.tag == Tag::String && !fmt.remaining_values.is_empty() {
                    tag.tag = Tag::StringPossiblyFormatted;
                }

                fmt.format::<W, true>(tag, writer, this_value, global)?;
                if fmt.remaining_values.is_empty() {
                    break;
                }

                this_value = fmt.remaining_values[0];
                fmt.remaining_values = &fmt.remaining_values[1..];
            }
            if level == MessageLevel::Error {
                let _ = writer.write_all(Output::pretty_fmt::<true>("<r>"));
            }
        } else {
            loop {
                if any {
                    let _ = writer.write_all(b" ");
                }
                any = true;
                tag = Tag::get(this_value, global)?;
                if tag.tag == Tag::String && !fmt.remaining_values.is_empty() {
                    tag.tag = Tag::StringPossiblyFormatted;
                }

                fmt.format::<W, false>(tag, writer, this_value, global)?;
                if fmt.remaining_values.is_empty() {
                    break;
                }

                this_value = fmt.remaining_values[0];
                fmt.remaining_values = &fmt.remaining_values[1..];
            }
        }

        if options.add_newline {
            let _ = writer.write_all(b"\n");
        }

        if options.flush {
            // TODO(port): writer.flush()
        }
        Ok(())
    }
}

// For detecting circular references
pub mod visited {
    use super::*;
    use bun_collections::pool::ObjectPool;

    // PORT NOTE: JSValue keys live on heap; safe because every visited value is also
    // on the stack frame during format() — conservative scan still sees them. Mirrors Zig 1:1.
    pub type Map = HashMap<JSValue, ()>;
    // TODO(port): ObjectPool with init fn, threadsafe=true, capacity=16.
    pub type Pool = ObjectPool<Map, 16>;
    pub type PoolNode = <Pool as ObjectPool<Map, 16>>::Node;
}

pub struct Formatter<'a> {
    pub remaining_values: &'a [JSValue],
    pub map: visited::Map,
    // TODO(port): lifetime — pool-owned node, released back via Pool guard (see JestPrettyFormat::format defer).
    pub map_node: Option<core::ptr::NonNull<visited::PoolNode>>,
    pub hide_native: bool,
    pub global_this: &'a JSGlobalObject,
    pub indent: u32,
    pub quote_strings: bool,
    pub failed: bool,
    pub estimated_line_length: usize,
    pub always_newline_scope: bool,
}

impl<'a> Formatter<'a> {
    pub fn new(global: &'a JSGlobalObject) -> Self {
        Self {
            remaining_values: &[],
            map: visited::Map::default(),
            map_node: None,
            hide_native: false,
            global_this: global,
            indent: 0,
            quote_strings: false,
            failed: false,
            estimated_line_length: 0,
            always_newline_scope: false,
        }
    }

    pub fn good_time_for_a_new_line(&mut self) -> bool {
        if self.estimated_line_length > 80 {
            self.reset_line();
            return true;
        }
        false
    }

    pub fn reset_line(&mut self) {
        self.estimated_line_length = (self.indent as usize) * 2;
    }

    pub fn add_for_new_line(&mut self, len: usize) {
        self.estimated_line_length = self.estimated_line_length.saturating_add(len);
    }
}

pub struct ZigFormatter<'a> {
    pub formatter: &'a mut Formatter<'a>,
    pub global: &'a JSGlobalObject,
    pub value: JSValue,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WriteError {
    #[error("UhOh")]
    UhOh,
}

impl<'a> core::fmt::Display for ZigFormatter<'a> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // TODO(port): UB — &self→&mut cast; Display takes &self but we need &mut Formatter.
        // Wrap `formatter` in RefCell or change protocol. NOT sound as written.
        let this = unsafe { &mut *(self as *const Self as *mut Self) };
        let single = [this.value];
        this.formatter.remaining_values = &single;
        // PORT NOTE: defer { self.formatter.remaining_values = &[] }
        this.formatter.global_this = this.global;
        let tag = match Tag::get(this.value, this.global) {
            Ok(t) => t,
            Err(_) => return Err(core::fmt::Error),
        };
        // TODO(port): core::fmt::Formatter is a text sink; format() now takes bun_io::Write.
        // Phase B should adapt via bun_io::FmtAdapter or rework ZigFormatter to write bytes directly.
        let mut adapter = bun_io::FmtAdapter::new(f);
        let result = this
            .formatter
            .format::<_, false>(tag, &mut adapter, this.value, this.global)
            .map_err(|_| core::fmt::Error);
        this.formatter.remaining_values = &[];
        result
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Tag {
    StringPossiblyFormatted,
    String,
    Undefined,
    Double,
    Integer,
    Null,
    Boolean,
    Array,
    Object,
    Function,
    Class,
    Error,
    TypedArray,
    Map,
    Set,
    Symbol,
    BigInt,

    GlobalObject,
    Private,
    Promise,

    JSON,
    NativeCode,
    ArrayBuffer,

    JSX,
    Event,
}

impl Tag {
    pub fn is_primitive(self) -> bool {
        matches!(
            self,
            Tag::String
                | Tag::StringPossiblyFormatted
                | Tag::Undefined
                | Tag::Double
                | Tag::Integer
                | Tag::Null
                | Tag::Boolean
                | Tag::Symbol
                | Tag::BigInt
        )
    }

    #[inline]
    pub const fn can_have_circular_references(self) -> bool {
        matches!(self, Tag::Array | Tag::Object | Tag::Map | Tag::Set)
    }
}

#[derive(Copy, Clone)]
pub struct TagResult {
    pub tag: Tag,
    pub cell: JSType,
}

impl Default for TagResult {
    fn default() -> Self {
        Self { tag: Tag::Undefined, cell: JSType::Cell }
    }
}

impl Tag {
    pub fn get(value: JSValue, global_this: &JSGlobalObject) -> JsResult<TagResult> {
        if value.is_empty() || value == JSValue::UNDEFINED {
            return Ok(TagResult { tag: Tag::Undefined, ..Default::default() });
        }
        if value == JSValue::NULL {
            return Ok(TagResult { tag: Tag::Null, ..Default::default() });
        }

        if value.is_int32() {
            return Ok(TagResult { tag: Tag::Integer, ..Default::default() });
        } else if value.is_number() {
            return Ok(TagResult { tag: Tag::Double, ..Default::default() });
        } else if value.is_boolean() {
            return Ok(TagResult { tag: Tag::Boolean, ..Default::default() });
        }

        if !value.is_cell() {
            return Ok(TagResult { tag: Tag::NativeCode, ..Default::default() });
        }

        let js_type = value.js_type();

        if js_type.is_hidden() {
            return Ok(TagResult { tag: Tag::NativeCode, cell: js_type });
        }

        // Cell is the "unknown" type
        if js_type == JSType::Cell {
            return Ok(TagResult { tag: Tag::NativeCode, cell: js_type });
        }

        if js_type == JSType::DOMWrapper {
            return Ok(TagResult { tag: Tag::Private, cell: js_type });
        }

        // If we check an Object has a method table and it does not
        // it will crash
        if js_type != JSType::Object && value.is_callable() {
            if value.is_class(global_this) {
                return Ok(TagResult { tag: Tag::Class, cell: js_type });
            }

            return Ok(TagResult {
                // TODO: we print InternalFunction as Object because we have a lot of
                // callable namespaces and printing the contents of it is better than [Function: namespace]
                // ideally, we would print [Function: namespace] { ... } on all functions, internal and js.
                // what we'll do later is rid of .Function and .Class and handle the prefix in the .Object formatter
                tag: if js_type == JSType::InternalFunction { Tag::Object } else { Tag::Function },
                cell: js_type,
            });
        }

        if js_type == JSType::GlobalProxy {
            return Tag::get(
                JSValue::c(CAPI::JSObjectGetProxyTarget(value.as_object_ref())),
                global_this,
            );
        }

        // Is this a react element?
        if js_type.is_object() && js_type != JSType::ProxyObject {
            if let Some(typeof_symbol) = value.get_own_truthy(global_this, "$$typeof")? {
                let mut react_element = ZigString::init(b"react.element");
                let mut react_fragment = ZigString::init(b"react.fragment");

                if typeof_symbol
                    .is_same_value(JSValue::symbol_for(global_this, &mut react_element), global_this)?
                    || typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, &mut react_fragment),
                        global_this,
                    )?
                {
                    return Ok(TagResult { tag: Tag::JSX, cell: js_type });
                }
            }
        }

        let tag = match js_type {
            JSType::ErrorInstance => Tag::Error,
            JSType::NumberObject => Tag::Double,
            JSType::DerivedArray | JSType::Array => Tag::Array,
            JSType::DerivedStringObject | JSType::String | JSType::StringObject => Tag::String,
            JSType::RegExpObject => Tag::String,
            JSType::Symbol => Tag::Symbol,
            JSType::BooleanObject => Tag::Boolean,
            JSType::JSFunction => Tag::Function,
            JSType::WeakMap | JSType::Map => Tag::Map,
            JSType::WeakSet | JSType::Set => Tag::Set,
            JSType::JSDate => Tag::JSON,
            JSType::JSPromise => Tag::Promise,
            JSType::Object
            | JSType::FinalObject
            | JSType::ModuleNamespaceObject
            | JSType::GlobalObject => Tag::Object,

            JSType::ArrayBuffer
            | JSType::Int8Array
            | JSType::Uint8Array
            | JSType::Uint8ClampedArray
            | JSType::Int16Array
            | JSType::Uint16Array
            | JSType::Int32Array
            | JSType::Uint32Array
            | JSType::Float16Array
            | JSType::Float32Array
            | JSType::Float64Array
            | JSType::BigInt64Array
            | JSType::BigUint64Array
            | JSType::DataView => Tag::TypedArray,

            JSType::HeapBigInt => Tag::BigInt,

            // None of these should ever exist here
            // But we're going to check anyway
            JSType::GetterSetter
            | JSType::CustomGetterSetter
            | JSType::APIValueWrapper
            | JSType::NativeExecutable
            | JSType::ProgramExecutable
            | JSType::ModuleProgramExecutable
            | JSType::EvalExecutable
            | JSType::FunctionExecutable
            | JSType::UnlinkedFunctionExecutable
            | JSType::UnlinkedProgramCodeBlock
            | JSType::UnlinkedModuleProgramCodeBlock
            | JSType::UnlinkedEvalCodeBlock
            | JSType::UnlinkedFunctionCodeBlock
            | JSType::CodeBlock
            | JSType::JSCellButterfly
            | JSType::JSSourceCode
            | JSType::JSCallee
            | JSType::GlobalLexicalEnvironment
            | JSType::LexicalEnvironment
            | JSType::ModuleEnvironment
            | JSType::StrictEvalActivation
            | JSType::WithScope => Tag::NativeCode,

            JSType::Event => Tag::Event,

            _ => Tag::JSON,
        };

        Ok(TagResult { tag, cell: js_type })
    }
}

type CellType = CAPI::CellType;

thread_local! {
    static NAME_BUF: RefCell<[u8; 512]> = const { RefCell::new([0u8; 512]) };
}

impl<'a> Formatter<'a> {
    fn write_with_formatting<W: bun_io::Write, S, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer_: &mut W,
        slice_: S,
        global_this: &JSGlobalObject,
    ) where
        S: AsRef<[u8]>,
        // TODO(port): Zig `Slice` is generic over u8/u16; this draft handles bytes only.
    {
        let mut writer = WrappedWriter::new(writer_);
        let mut slice = slice_.as_ref();
        let mut i: u32 = 0;
        let mut len: u32 = slice.len() as u32;
        let mut any_non_ascii = false;
        while i < len {
            match slice[i as usize] {
                b'%' => {
                    i += 1;
                    if i >= len {
                        break;
                    }

                    let token = match slice[i as usize] {
                        b's' => Tag::String,
                        b'f' => Tag::Double,
                        b'o' => Tag::Undefined,
                        b'O' => Tag::Object,
                        b'd' | b'i' => Tag::Integer,
                        _ => {
                            i += 1;
                            continue;
                        }
                    };

                    // Flush everything up to the %
                    let end = &slice[0..(i as usize - 1)];
                    if !any_non_ascii {
                        writer.write_all(end);
                    } else {
                        writer.write_all(end);
                    }
                    any_non_ascii = false;
                    let advance = (i as usize + 1).min(slice.len());
                    slice = &slice[advance..];
                    i = 0;
                    len = slice.len() as u32;
                    let next_value = self.remaining_values[0];
                    self.remaining_values = &self.remaining_values[1..];
                    let r = match token {
                        Tag::String => self.print_as::<W, { Tag::String }, ENABLE_ANSI_COLORS>(
                            writer.ctx, next_value, next_value.js_type(),
                        ),
                        Tag::Double => self.print_as::<W, { Tag::Double }, ENABLE_ANSI_COLORS>(
                            writer.ctx, next_value, next_value.js_type(),
                        ),
                        Tag::Object => self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx, next_value, next_value.js_type(),
                        ),
                        Tag::Integer => self.print_as::<W, { Tag::Integer }, ENABLE_ANSI_COLORS>(
                            writer.ctx, next_value, next_value.js_type(),
                        ),

                        // undefined is overloaded to mean the '%o" field
                        Tag::Undefined => match Tag::get(next_value, global_this) {
                            Ok(tag) => self.format::<W, ENABLE_ANSI_COLORS>(
                                tag, writer.ctx, next_value, global_this,
                            ),
                            Err(_) => return,
                        },

                        _ => unreachable!(),
                    };
                    if r.is_err() {
                        return;
                    }
                    if self.remaining_values.is_empty() {
                        break;
                    }
                }
                b'\\' => {
                    i += 1;
                    if i >= len {
                        break;
                    }
                    if slice[i as usize] == b'%' {
                        i += 2;
                    }
                }
                128..=255 => {
                    any_non_ascii = true;
                }
                _ => {}
            }
            i += 1;
        }

        if !slice.is_empty() {
            writer.write_all(slice);
        }
    }
}

pub struct WrappedWriter<'w, W: bun_io::Write> {
    pub ctx: &'w mut W,
    pub failed: bool,
    pub estimated_line_length: Option<&'w mut usize>,
}

impl<'w, W: bun_io::Write> WrappedWriter<'w, W> {
    pub fn new(ctx: &'w mut W) -> Self {
        Self { ctx, failed: false, estimated_line_length: None }
    }

    pub fn print(&mut self, args: core::fmt::Arguments<'_>) {
        if self.ctx.write_fmt(args).is_err() {
            self.failed = true;
        }
    }

    pub fn write_latin1(&mut self, buf: &[u8]) {
        let mut remain = buf;
        while !remain.is_empty() {
            if let Some(i) = strings::first_non_ascii(remain) {
                if i > 0 {
                    if self.write_all_raw(&remain[..i as usize]).is_err() {
                        self.failed = true;
                        return;
                    }
                }
                let bytes = strings::latin1_to_codepoint_bytes_assume_not_ascii(remain[i as usize]);
                if self.write_all_raw(&bytes).is_err() {
                    self.failed = true;
                }
                remain = &remain[i as usize + 1..];
            } else {
                break;
            }
        }

        let _ = self.write_all_raw(remain);
    }

    #[inline]
    pub fn write_all(&mut self, buf: &[u8]) {
        if self.write_all_raw(buf).is_err() {
            self.failed = true;
        }
    }

    #[inline]
    fn write_all_raw(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.ctx.write_all(buf)
    }

    #[inline]
    pub fn write_string(&mut self, str: ZigString) {
        self.print(format_args!("{}", str));
    }

    #[inline]
    pub fn write_16_bit(&mut self, input: &[u16]) {
        if bun_fmt::format_utf16_type(input, self.ctx).is_err() {
            self.failed = true;
        }
    }
}

impl<'a> Formatter<'a> {
    pub fn write_indent<W: bun_io::Write>(&self, writer: &mut W) -> bun_io::Result<()> {
        let indent = self.indent.min(32);
        let buf = [b' '; 64];
        let mut total_remain: usize = indent as usize;
        while total_remain > 0 {
            let written: usize = total_remain.min(32);
            writer.write_all(&buf[0..written * 2])?;
            total_remain = total_remain.saturating_sub(written);
        }
        Ok(())
    }

    pub fn print_comma<W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> bun_io::Result<()> {
        writer.write_all(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>,<r>"))?;
        self.estimated_line_length += 1;
        Ok(())
    }
}

pub struct MapIterator<'a, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub formatter: &'a mut Formatter<'a>,
    pub writer: &'a mut W,
}

impl<'a, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    MapIterator<'a, W, ENABLE_ANSI_COLORS>
{
    pub extern "C" fn for_each(
        _: *mut VM,
        global_object: *mut JSGlobalObject,
        ctx: *mut c_void,
        next_value: JSValue,
    ) {
        // SAFETY: ctx was passed as `&mut Self as *mut c_void` by the caller of for_each.
        let Some(ctx) = (unsafe { (ctx as *mut Self).as_mut() }) else { return };
        // SAFETY: global_object is non-null per JSC contract.
        let global_object = unsafe { &*global_object };
        if ctx.formatter.failed {
            return;
        }
        let Ok(key) = JSObject::get_index(next_value, global_object, 0) else { return };
        let Ok(value) = JSObject::get_index(next_value, global_object, 1) else { return };
        if ctx.formatter.write_indent(ctx.writer).is_err() {
            return;
        }
        let Ok(key_tag) = Tag::get(key, global_object) else { return };

        if ctx
            .formatter
            .format::<W, ENABLE_ANSI_COLORS>(key_tag, ctx.writer, key, ctx.formatter.global_this)
            .is_err()
        {
            return;
        }
        if ctx.writer.write_all(b" => ").is_err() {
            return;
        }
        let Ok(value_tag) = Tag::get(value, global_object) else { return };
        if ctx
            .formatter
            .format::<W, ENABLE_ANSI_COLORS>(value_tag, ctx.writer, value, ctx.formatter.global_this)
            .is_err()
        {
            return;
        }
        if ctx.formatter.print_comma::<W, ENABLE_ANSI_COLORS>(ctx.writer).is_err() {
            return;
        }
        let _ = ctx.writer.write_all(b"\n");
    }
}

pub struct SetIterator<'a, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub formatter: &'a mut Formatter<'a>,
    pub writer: &'a mut W,
}

impl<'a, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    SetIterator<'a, W, ENABLE_ANSI_COLORS>
{
    pub extern "C" fn for_each(
        _: *mut VM,
        global_object: *mut JSGlobalObject,
        ctx: *mut c_void,
        next_value: JSValue,
    ) {
        // SAFETY: ctx was passed as `&mut Self as *mut c_void` by the caller of for_each.
        let Some(ctx) = (unsafe { (ctx as *mut Self).as_mut() }) else { return };
        // SAFETY: global_object is non-null per JSC contract.
        let global_object = unsafe { &*global_object };
        if ctx.formatter.failed {
            return;
        }
        if ctx.formatter.write_indent(ctx.writer).is_err() {
            return;
        }
        let Ok(key_tag) = Tag::get(next_value, global_object) else { return };
        if ctx
            .formatter
            .format::<W, ENABLE_ANSI_COLORS>(
                key_tag,
                ctx.writer,
                next_value,
                ctx.formatter.global_this,
            )
            .is_err()
        {
            return;
        }
        if ctx.formatter.print_comma::<W, ENABLE_ANSI_COLORS>(ctx.writer).is_err() {
            return;
        }
        let _ = ctx.writer.write_all(b"\n");
    }
}

pub struct PropertyIterator<'a, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub formatter: &'a mut Formatter<'a>,
    pub writer: &'a mut W,
    pub i: usize,
    pub always_newline: bool,
    pub parent: JSValue,
}

impl<'a, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    PropertyIterator<'a, W, ENABLE_ANSI_COLORS>
{
    pub fn handle_first_property(
        &mut self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        if !value.js_type().is_function() {
            let mut writer = WrappedWriter::new(self.writer);
            let mut name_str = ZigString::init(b"");

            value.get_name_property(global_this, &mut name_str)?;
            if name_str.len > 0 && !name_str.eql_comptime(b"Object") {
                writer.print(format_args!("{} ", name_str));
            } else {
                value
                    .get_prototype(global_this)
                    .get_name_property(global_this, &mut name_str)?;
                if name_str.len > 0 && !name_str.eql_comptime(b"Object") {
                    writer.print(format_args!("{} ", name_str));
                }
            }
        }

        self.always_newline = true;
        self.formatter.estimated_line_length = (self.formatter.indent as usize) * 2 + 1;

        if self.formatter.indent == 0 {
            let _ = self.writer.write_all(b"\n");
        }
        let mut classname = ZigString::EMPTY;
        value.get_class_name(global_this, &mut classname)?;
        if !classname.is_empty() && !classname.eql_comptime(b"Object") {
            let _ = self.writer.write_fmt(format_args!("{} ", classname));
        }

        let _ = self.writer.write_all(b"{\n");
        self.formatter.indent += 1;
        let _ = self.formatter.write_indent(self.writer);
        Ok(())
    }

    pub extern "C" fn for_each(
        global_this: *mut JSGlobalObject,
        ctx_ptr: *mut c_void,
        key_: *mut ZigString,
        value: JSValue,
        is_symbol: bool,
        is_private_symbol: bool,
    ) {
        if is_private_symbol {
            return;
        }

        // SAFETY: key_ is non-null per JSC contract for property iteration.
        let key = unsafe { *key_ };
        if key.eql_comptime(b"constructor") {
            return;
        }

        // SAFETY: ctx_ptr was passed as `&mut Self as *mut c_void` by the caller of for_each.
        let Some(ctx) = (unsafe { (ctx_ptr as *mut Self).as_mut() }) else { return };
        // SAFETY: global_this is non-null per JSC contract.
        let global_this = unsafe { &*global_this };
        let this = &mut *ctx.formatter;
        let writer_ = &mut *ctx.writer;
        if this.failed {
            return;
        }

        // PORT NOTE: reshaped for borrowck — WrappedWriter borrows writer_ exclusively;
        // we re-borrow writer_ directly for nested calls below.
        let mut writer = WrappedWriter::new(writer_);

        let Ok(tag) = Tag::get(value, global_this) else { return };

        if tag.cell.is_hidden() {
            return;
        }
        if ctx.i == 0 {
            // PORT NOTE: re-borrow ctx; drop `writer` first.
            drop(writer);
            if Self::handle_first_property(ctx, global_this, ctx.parent).is_err() {
                return;
            }
            writer = WrappedWriter::new(&mut *ctx.writer);
        } else {
            if this.print_comma::<W, ENABLE_ANSI_COLORS>(writer.ctx).is_err() {
                return;
            }
        }

        // PORT NOTE: defer ctx.i += 1 — incremented at end of fn.
        if ctx.i > 0 {
            if ctx.always_newline || this.always_newline_scope || this.good_time_for_a_new_line() {
                writer.write_all(b"\n");
                if this.write_indent(writer.ctx).is_err() {
                    ctx.i += 1;
                    return;
                }
                this.reset_line();
            } else {
                this.estimated_line_length += 1;
                writer.write_all(b" ");
            }
        }

        if !is_symbol {
            // TODO: make this one pass?
            if !key.is_16_bit() && JSLexer::is_latin1_identifier_bytes(key.slice()) {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    concat!("{}", "\"{}\"", "{}", ":", "{}", " "),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    key,
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            } else if key.is_16_bit()
                && JSLexer::is_latin1_identifier_utf16(key.utf16_slice_aligned())
            {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    concat!("{}", "\"{}\"", "{}", ":", "{}", " "),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    key,
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            } else if key.is_16_bit() {
                let utf16_slice = key.utf16_slice_aligned();

                this.add_for_new_line(utf16_slice.len() + 2);

                if ENABLE_ANSI_COLORS {
                    writer.write_all(Output::pretty_fmt::<true>("<r><green>").as_bytes());
                }

                writer.write_all(b"\"");
                writer.write_16_bit(utf16_slice);
                writer.print(format_args!(
                    "\"{}:{} ",
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            } else {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    "{}{}{}:{} ",
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><green>"),
                    bun_fmt::format_json_string_latin1(key.slice()),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            }
        } else {
            this.add_for_new_line(1 + b"[Symbol()]:".len() + key.len);
            writer.print(format_args!(
                "{}[{}Symbol({}){}]:{} ",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"),
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                key,
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"),
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
            ));
        }

        if tag.cell.is_string_like() {
            if ENABLE_ANSI_COLORS {
                writer.write_all(Output::pretty_fmt::<true>("<r><green>").as_bytes());
            }
        }

        if this
            .format::<W, ENABLE_ANSI_COLORS>(tag, writer.ctx, value, global_this)
            .is_err()
        {
            ctx.i += 1;
            return;
        }

        if tag.cell.is_string_like() {
            if ENABLE_ANSI_COLORS {
                writer.write_all(Output::pretty_fmt::<true>("<r>").as_bytes());
            }
        }

        ctx.i += 1;
    }
}

impl<'a> Formatter<'a> {
    pub fn print_as<W: bun_io::Write, const FORMAT: Tag, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer_: &mut W,
        value: JSValue,
        js_type: JSType,
    ) -> JsResult<()> {
        if self.failed {
            return Ok(());
        }
        // PORT NOTE: reshaped for borrowck — `WrappedWriter` borrows both writer_
        // and &mut self.estimated_line_length; we use a local wrapper and sync
        // `failed` at scope exit. estimated_line_length is unused by WrappedWriter
        // methods in this file, so we leave it None here.
        let mut writer = WrappedWriter::new(writer_);
        let result: JsResult<()> = (|| {
            if FORMAT.can_have_circular_references() {
                if self.map_node.is_none() {
                    // TODO(port): Visited::Pool::get() — pool guard semantics
                    self.map_node = Some(visited::Pool::get());
                    self.map_node.as_mut().unwrap().data.clear();
                    self.map = core::mem::take(&mut self.map_node.as_mut().unwrap().data);
                }

                let entry = self.map.get_or_put(value).expect("unreachable");
                if entry.found_existing {
                    writer.write_all(
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><cyan>[Circular]<r>").as_bytes(),
                    );
                    return Ok(());
                }
            }

            // PORT NOTE: defer { if FORMAT.can_have_circular_references() { self.map.remove(&value); } }
            // — handled at fn end via scopeguard-style manual cleanup below.
            let guard = scopeguard::guard((), |_| {
                if FORMAT.can_have_circular_references() {
                    let _ = self.map.remove(&value);
                }
            });
            // TODO(port): scopeguard captures &mut self; borrowck conflict with body.
            // Phase B: hoist remove() to end of match instead.
            let _ = scopeguard::ScopeGuard::into_inner(guard);

            match FORMAT {
                Tag::StringPossiblyFormatted => {
                    let str = value.to_slice(self.global_this)?;
                    self.add_for_new_line(str.len());
                    let slice = str.slice();
                    self.write_with_formatting::<W, _, ENABLE_ANSI_COLORS>(
                        writer.ctx,
                        slice,
                        self.global_this,
                    );
                }
                Tag::String => {
                    let mut str = ZigString::init(b"");
                    value.to_zig_string(&mut str, self.global_this)?;
                    self.add_for_new_line(str.len);

                    if value.js_type() == JSType::StringObject
                        || value.js_type() == JSType::DerivedStringObject
                    {
                        if str.len == 0 {
                            writer.write_all(b"String {}");
                            return Ok(());
                        }
                        if self.indent == 0 && str.len > 0 {
                            writer.write_all(b"\n");
                        }
                        writer.write_all(b"String {\n");
                        self.indent += 1;
                        self.reset_line();
                        self.write_indent(writer.ctx).expect("unreachable");
                        let length = str.len;
                        for (i, c) in str.slice().iter().enumerate() {
                            writer.print(format_args!("\"{}\": \"{}\",\n", i, *c as char));
                            if i != length - 1 {
                                self.write_indent(writer.ctx).expect("unreachable");
                            }
                        }
                        self.indent = self.indent.saturating_sub(1);
                        self.reset_line();
                        writer.write_all(b"}\n");
                        return Ok(());
                    }

                    if self.quote_strings && js_type != JSType::RegExpObject {
                        if str.len == 0 {
                            writer.write_all(b"\"\"");
                            return Ok(());
                        }

                        if ENABLE_ANSI_COLORS {
                            writer.write_all(Output::pretty_fmt::<true>("<r><green>").as_bytes());
                        }

                        let mut has_newline = false;

                        if str.index_of_any(b"\n\r").is_some() {
                            has_newline = true;
                            writer.write_all(b"\n");
                        }

                        writer.write_all(b"\"");
                        let mut remaining = str;
                        while let Some(i) = remaining.index_of_any(b"\\\r") {
                            match remaining.char_at(i) {
                                b'\\' => {
                                    writer.print(format_args!(
                                        "{}\\",
                                        remaining.substring_with_len(0, i)
                                    ));
                                    remaining = remaining.substring(i + 1);
                                }
                                b'\r' => {
                                    if i + 1 < remaining.len
                                        && remaining.char_at(i + 1) == b'\n'
                                    {
                                        writer.print(format_args!(
                                            "{}",
                                            remaining.substring_with_len(0, i)
                                        ));
                                    } else {
                                        writer.print(format_args!(
                                            "{}\n",
                                            remaining.substring_with_len(0, i)
                                        ));
                                    }

                                    remaining = remaining.substring(i + 1);
                                }
                                _ => unreachable!(),
                            }
                        }

                        writer.write_string(remaining);
                        writer.write_all(b"\"");

                        if ENABLE_ANSI_COLORS {
                            writer.write_all(Output::pretty_fmt::<true>("<r>").as_bytes());
                        }

                        if has_newline {
                            writer.write_all(b"\n");
                        }
                        return Ok(());
                    }

                    if js_type == JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!(
                            "{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><red>")
                        ));
                    }

                    if str.is_16_bit() {
                        // streaming print
                        writer.print(format_args!("{}", str));
                    } else if strings::is_all_ascii(str.slice()) {
                        // fast path
                        writer.write_all(str.slice());
                    } else if str.len > 0 {
                        // slow path
                        let buf = strings::allocate_latin1_into_utf8(str.slice())
                            .unwrap_or_else(|_| Box::<[u8]>::default());
                        if !buf.is_empty() {
                            writer.write_all(&buf);
                        }
                    }

                    if js_type == JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!(
                            "{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>")
                        ));
                    }
                }
                Tag::Integer => {
                    let int = value.to_int64();
                    if int < u32::MAX as i64 {
                        let mut i = int;
                        let is_negative = i < 0;
                        if is_negative {
                            i = -i;
                        }
                        let digits = if i != 0 {
                            bun_fmt::fast_digit_count(usize::try_from(i).unwrap())
                                + (is_negative as usize)
                        } else {
                            1
                        };
                        self.add_for_new_line(digits);
                    } else {
                        self.add_for_new_line(bun_fmt::count_decimal_i64(int));
                    }
                    writer.print(format_args!(
                        "{}{}{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                        int,
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::BigInt => {
                    let out_str = value.get_zig_string(self.global_this)?.slice();
                    self.add_for_new_line(out_str.len());

                    writer.print(format_args!(
                        "{}{}n{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                        bstr::BStr::new(out_str),
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::Double => {
                    if value.is_cell() {
                        self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx, value, JSType::Object,
                        )?;
                        return Ok(());
                    }

                    let num = value.as_number();

                    if num.is_infinite() && num.is_sign_positive() {
                        self.add_for_new_line(b"Infinity".len());
                        writer.print(format_args!(
                            "{}Infinity{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else if num.is_infinite() && num.is_sign_negative() {
                        self.add_for_new_line(b"-Infinity".len());
                        writer.print(format_args!(
                            "{}-Infinity{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else if num.is_nan() {
                        self.add_for_new_line(b"NaN".len());
                        writer.print(format_args!(
                            "{}NaN{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        self.add_for_new_line(bun_fmt::count_decimal_f64(num));
                        writer.print(format_args!(
                            "{}{}{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            num,
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    }
                }
                Tag::Undefined => {
                    self.add_for_new_line(9);
                    writer.print(format_args!(
                        "{}undefined{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><d>"),
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::Null => {
                    self.add_for_new_line(4);
                    writer.print(format_args!(
                        "{}null{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::Symbol => {
                    let description = value.get_description(self.global_this);
                    self.add_for_new_line(b"Symbol".len());

                    if description.len > 0 {
                        self.add_for_new_line(description.len + b"()".len());
                        writer.print(format_args!(
                            "{}Symbol({}){}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                            description,
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}Symbol{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    }
                }
                Tag::Error => {
                    let mut classname = ZigString::EMPTY;
                    value.get_class_name(self.global_this, &mut classname)?;
                    let mut message_string = bun_str::String::empty();

                    if let Some(message_prop) = value.fast_get(self.global_this, jsc::BuiltinName::Message)? {
                        message_string = message_prop.to_bun_string(self.global_this)?;
                    }

                    if message_string.is_empty() {
                        writer.print(format_args!("[{}]", classname));
                        return Ok(());
                    }
                    writer.print(format_args!("[{}: {}]", classname, message_string));
                    return Ok(());
                }
                Tag::Class => {
                    let mut printable = NAME_BUF.with_borrow(|b| ZigString::init(&b[..]));
                    value.get_class_name(self.global_this, &mut printable)?;
                    self.add_for_new_line(printable.len);

                    if printable.len == 0 {
                        writer.print(format_args!(
                            "{}[class]{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<cyan>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[class {}]{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<cyan>"),
                            printable,
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    }
                }
                Tag::Function => {
                    let mut printable = NAME_BUF.with_borrow(|b| ZigString::init(&b[..]));
                    value.get_name_property(self.global_this, &mut printable)?;

                    if printable.len == 0 {
                        writer.print(format_args!(
                            "{}[Function]{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<cyan>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[Function: {}]{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<cyan>"),
                            printable,
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    }
                }
                Tag::Array => {
                    let len: u32 = value.get_length(self.global_this)? as u32;
                    if len == 0 {
                        writer.write_all(b"[]");
                        self.add_for_new_line(2);
                        return Ok(());
                    }

                    if self.indent == 0 {
                        writer.write_all(b"\n");
                    }

                    let mut was_good_time = self.always_newline_scope;
                    {
                        self.indent += 1;

                        self.add_for_new_line(2);

                        let r#ref = value.as_object_ref();

                        let prev_quote_strings = self.quote_strings;
                        self.quote_strings = true;

                        {
                            let element = JSValue::from_ref(CAPI::JSObjectGetPropertyAtIndex(
                                self.global_this, r#ref, 0, core::ptr::null_mut(),
                            ));
                            let tag = Tag::get(element, self.global_this)?;

                            was_good_time = was_good_time
                                || !tag.tag.is_primitive()
                                || self.good_time_for_a_new_line();

                            self.reset_line();
                            writer.write_all(b"[");
                            writer.write_all(b"\n");
                            self.write_indent(writer.ctx).expect("unreachable");
                            self.add_for_new_line(1);

                            self.format::<W, ENABLE_ANSI_COLORS>(
                                tag, writer.ctx, element, self.global_this,
                            )?;

                            if tag.cell.is_string_like() {
                                if ENABLE_ANSI_COLORS {
                                    writer.write_all(
                                        Output::pretty_fmt::<true>("<r>").as_bytes(),
                                    );
                                }
                            }

                            if len == 1 {
                                self.print_comma::<W, ENABLE_ANSI_COLORS>(writer.ctx)
                                    .expect("unreachable");
                            }
                        }

                        let mut i: u32 = 1;
                        while i < len {
                            self.print_comma::<W, ENABLE_ANSI_COLORS>(writer.ctx)
                                .expect("unreachable");

                            writer.write_all(b"\n");
                            self.write_indent(writer.ctx).expect("unreachable");

                            let element = JSValue::from_ref(CAPI::JSObjectGetPropertyAtIndex(
                                self.global_this, r#ref, i, core::ptr::null_mut(),
                            ));
                            let tag = Tag::get(element, self.global_this)?;

                            self.format::<W, ENABLE_ANSI_COLORS>(
                                tag, writer.ctx, element, self.global_this,
                            )?;

                            if tag.cell.is_string_like() {
                                if ENABLE_ANSI_COLORS {
                                    writer.write_all(
                                        Output::pretty_fmt::<true>("<r>").as_bytes(),
                                    );
                                }
                            }

                            if i == len - 1 {
                                self.print_comma::<W, ENABLE_ANSI_COLORS>(writer.ctx)
                                    .expect("unreachable");
                            }
                            i += 1;
                        }

                        self.quote_strings = prev_quote_strings;
                        self.indent = self.indent.saturating_sub(1);
                    }

                    self.reset_line();
                    writer.write_all(b"\n");
                    let _ = self.write_indent(writer.ctx);
                    writer.write_all(b"]");
                    if self.indent == 0 {
                        writer.write_all(b"\n");
                    }
                    self.reset_line();
                    self.add_for_new_line(1);
                }
                Tag::Private => {
                    if let Some(response) = value.as_::<jsc::webcore::Response>() {
                        if let Err(err) =
                            response.write_format::<Formatter, _, ENABLE_ANSI_COLORS>(self, writer.ctx)
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(err, "failed to print Response"));
                            }
                            return Err(JsError::Thrown);
                        }
                    } else if let Some(request) = value.as_::<jsc::webcore::Request>() {
                        if let Err(err) =
                            request.write_format::<Formatter, _, ENABLE_ANSI_COLORS>(value, self, writer.ctx)
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(err, "failed to print Request"));
                            }
                            return Err(JsError::Thrown);
                        }
                        return Ok(());
                    } else if let Some(build) = value.as_::<jsc::api::BuildArtifact>() {
                        if let Err(err) =
                            build.write_format::<Formatter, _, ENABLE_ANSI_COLORS>(self, writer.ctx)
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(err, "failed to print BuildArtifact"));
                            }
                            return Err(JsError::Thrown);
                        }
                    } else if let Some(blob) = value.as_::<jsc::webcore::Blob>() {
                        if let Err(err) =
                            blob.write_format::<Formatter, _, ENABLE_ANSI_COLORS>(self, writer.ctx)
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(err, "failed to print Blob"));
                            }
                            return Err(JsError::Thrown);
                        }
                        return Ok(());
                    } else if value.as_::<jsc::DOMFormData>().is_some() {
                        let to_json_function = value.get(self.global_this, "toJSON")?.unwrap();

                        self.add_for_new_line(b"FormData (entries) ".len());
                        writer.write_all(
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                                "<r><blue>FormData<r> <d>(entries)<r> ",
                            )
                            .as_bytes(),
                        );

                        return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx,
                            to_json_function.call(self.global_this, value, &[])?,
                            JSType::Object,
                        );
                    } else if let Some(timer) = value.as_::<bun_runtime::api::timer::TimeoutObject>() {
                        self.add_for_new_line(
                            b"Timeout(# ) ".len()
                                + bun_fmt::fast_digit_count(
                                    u64::try_from(timer.internals.id.max(0)).unwrap(),
                                ),
                        );
                        if timer.internals.flags.kind == bun_runtime::api::timer::Kind::SetInterval {
                            self.add_for_new_line(
                                b"repeats ".len()
                                    + bun_fmt::fast_digit_count(
                                        u64::try_from(timer.internals.id.max(0)).unwrap(),
                                    ),
                            );
                            writer.print(format_args!(
                                "{}Timeout{} {}(#{}{}{}{}, repeats){}",
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<yellow>"),
                                timer.internals.id,
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                            ));
                        } else {
                            writer.print(format_args!(
                                "{}Timeout{} {}(#{}{}{}{}){}",
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<yellow>"),
                                timer.internals.id,
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                            ));
                        }

                        return Ok(());
                    } else if let Some(immediate) =
                        value.as_::<bun_runtime::api::timer::ImmediateObject>()
                    {
                        self.add_for_new_line(
                            b"Immediate(# ) ".len()
                                + bun_fmt::fast_digit_count(
                                    u64::try_from(immediate.internals.id.max(0)).unwrap(),
                                ),
                        );
                        writer.print(format_args!(
                            "{}Immediate{} {}(#{}{}{}{}){}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<yellow>"),
                            immediate.internals.id,
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));

                        return Ok(());
                    } else if let Some(build_log) = value.as_::<bun_runtime::api::BuildMessage>() {
                        let _ = build_log.msg.write_format::<_, ENABLE_ANSI_COLORS>(writer.ctx);
                        return Ok(());
                    } else if let Some(resolve_log) = value.as_::<bun_runtime::api::ResolveMessage>() {
                        let _ = resolve_log.msg.write_format::<_, ENABLE_ANSI_COLORS>(writer.ctx);
                        return Ok(());
                    } else if NAME_BUF.with_borrow(|name_buf| {
                        // TODO(port): printAsymmetricMatcher takes name_buf by value [512]u8;
                        // borrowck conflict with `writer`. Phase B: pass &mut [u8; 512].
                        JestPrettyFormat::print_asymmetric_matcher::<W, FORMAT, ENABLE_ANSI_COLORS>(
                            self, &mut writer, writer.ctx, *name_buf, value,
                        )
                    })? {
                        return Ok(());
                    } else if js_type != JSType::DOMWrapper {
                        if value.is_callable() {
                            return self.print_as::<W, { Tag::Function }, ENABLE_ANSI_COLORS>(
                                writer.ctx, value, js_type,
                            );
                        }

                        return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx, value, js_type,
                        );
                    }
                    return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                        writer.ctx, value, JSType::Event,
                    );
                }
                Tag::NativeCode => {
                    self.add_for_new_line(b"[native code]".len());
                    writer.write_all(b"[native code]");
                }
                Tag::Promise => {
                    if self.good_time_for_a_new_line() {
                        writer.write_all(b"\n");
                        let _ = self.write_indent(writer.ctx);
                    }
                    writer.write_all(b"Promise {}");
                }
                Tag::Boolean => {
                    if value.is_cell() {
                        self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx, value, JSType::Object,
                        )?;
                        return Ok(());
                    }
                    if value.to_boolean() {
                        self.add_for_new_line(4);
                        writer.write_all(
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>true<r>").as_bytes(),
                        );
                    } else {
                        self.add_for_new_line(5);
                        writer.write_all(
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><yellow>false<r>").as_bytes(),
                        );
                    }
                }
                Tag::GlobalObject => {
                    const FMT: &str = "[this.globalThis]";
                    self.add_for_new_line(FMT.len());
                    writer.write_all(
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>(concat!(
                            "<cyan>", "[this.globalThis]", "<r>"
                        ))
                        .as_bytes(),
                    );
                }
                Tag::Map => {
                    let length_value = value
                        .get(self.global_this, "size")?
                        .unwrap_or_else(|| JSValue::js_number_from_int32(0));
                    let length = length_value.to_int32();

                    let prev_quote_strings = self.quote_strings;
                    self.quote_strings = true;

                    let map_name: &str =
                        if value.js_type() == JSType::WeakMap { "WeakMap" } else { "Map" };

                    if length == 0 {
                        self.quote_strings = prev_quote_strings;
                        return Ok(writer.print(format_args!("{} {{}}", map_name)));
                    }

                    writer.print(format_args!("\n{} {{\n", map_name));
                    {
                        self.indent += 1;
                        let mut iter = MapIterator::<W, ENABLE_ANSI_COLORS> {
                            formatter: self,
                            writer: writer.ctx,
                        };
                        // TODO(port): borrowck conflict — iter borrows self & writer.ctx mutably.
                        let result = value.for_each(
                            self.global_this,
                            &mut iter as *mut _ as *mut c_void,
                            MapIterator::<W, ENABLE_ANSI_COLORS>::for_each,
                        );
                        self.indent = self.indent.saturating_sub(1);
                        result?;
                    }
                    let _ = self.write_indent(writer.ctx);
                    writer.write_all(b"}");
                    writer.write_all(b"\n");
                    self.quote_strings = prev_quote_strings;
                }
                Tag::Set => {
                    let length_value = value
                        .get(self.global_this, "size")?
                        .unwrap_or_else(|| JSValue::js_number_from_int32(0));
                    let length = length_value.to_int32();

                    let prev_quote_strings = self.quote_strings;
                    self.quote_strings = true;

                    let _ = self.write_indent(writer.ctx);

                    let set_name: &str =
                        if value.js_type() == JSType::WeakSet { "WeakSet" } else { "Set" };

                    if length == 0 {
                        self.quote_strings = prev_quote_strings;
                        return Ok(writer.print(format_args!("{} {{}}", set_name)));
                    }

                    writer.print(format_args!("\n{} {{\n", set_name));
                    {
                        self.indent += 1;
                        let mut iter = SetIterator::<W, ENABLE_ANSI_COLORS> {
                            formatter: self,
                            writer: writer.ctx,
                        };
                        // TODO(port): borrowck conflict — iter borrows self & writer.ctx mutably.
                        let result = value.for_each(
                            self.global_this,
                            &mut iter as *mut _ as *mut c_void,
                            SetIterator::<W, ENABLE_ANSI_COLORS>::for_each,
                        );
                        self.indent = self.indent.saturating_sub(1);
                        result?;
                    }
                    let _ = self.write_indent(writer.ctx);
                    writer.write_all(b"}");
                    writer.write_all(b"\n");
                    self.quote_strings = prev_quote_strings;
                }
                Tag::JSON => {
                    let mut str = bun_str::String::empty();

                    value.json_stringify(self.global_this, self.indent, &mut str)?;
                    self.add_for_new_line(str.length());
                    if js_type == JSType::JSDate {
                        // in the code for printing dates, it never exceeds this amount
                        let mut iso_string_buf = [0u8; 36];
                        let mut out_buf: &[u8] = {
                            use std::io::Write;
                            let mut cursor = &mut iso_string_buf[..];
                            match write!(cursor, "{}", str) {
                                Ok(()) => {
                                    let written = 36 - cursor.len();
                                    &iso_string_buf[..written]
                                }
                                Err(_) => b"",
                            }
                        };
                        if out_buf.len() > 2 {
                            // trim the quotes
                            out_buf = &out_buf[1..out_buf.len() - 1];
                        }

                        writer.print(format_args!(
                            "{}{}{}",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><magenta>"),
                            bstr::BStr::new(out_buf),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                        return Ok(());
                    }

                    writer.print(format_args!("{}", str));
                }
                Tag::Event => {
                    let event_type_value: JSValue = 'brk: {
                        let value_: JSValue = match value.get(self.global_this, "type")? {
                            Some(v) => v,
                            None => break 'brk JSValue::UNDEFINED,
                        };
                        if value_.is_string() {
                            break 'brk value_;
                        }

                        JSValue::UNDEFINED
                    };

                    let event_type = match EventType::MAP
                        .from_js(self.global_this, event_type_value)?
                        .unwrap_or(EventType::Unknown)
                    {
                        evt @ (EventType::MessageEvent | EventType::ErrorEvent) => evt,
                        _ => {
                            return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                                writer.ctx, value, JSType::Event,
                            );
                        }
                    };

                    writer.print(format_args!(
                        "{}{}{} {{\n",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><cyan>"),
                        <&'static str>::from(event_type),
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                    {
                        self.indent += 1;
                        let old_quote_strings = self.quote_strings;
                        self.quote_strings = true;
                        self.write_indent(writer.ctx).expect("unreachable");

                        writer.print(format_args!(
                            "{}type: {}\"{}\"{}{},{}\n",
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<green>"),
                            bstr::BStr::new(event_type.label()),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                        ));

                        if let Some(message_value) =
                            value.fast_get(self.global_this, jsc::BuiltinName::Message)?
                        {
                            if message_value.is_string() {
                                self.write_indent(writer.ctx).expect("unreachable");
                                writer.print(format_args!(
                                    "{}message{}:{} ",
                                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                ));

                                let tag = Tag::get(message_value, self.global_this)?;
                                self.format::<W, ENABLE_ANSI_COLORS>(
                                    tag, writer.ctx, message_value, self.global_this,
                                )?;
                                writer.write_all(b", \n");
                            }
                        }

                        match event_type {
                            EventType::MessageEvent => {
                                self.write_indent(writer.ctx).expect("unreachable");
                                writer.print(format_args!(
                                    "{}data{}:{} ",
                                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                ));
                                let data: JSValue = value
                                    .fast_get(self.global_this, jsc::BuiltinName::Data)?
                                    .unwrap_or(JSValue::UNDEFINED);
                                let tag = Tag::get(data, self.global_this)?;

                                if tag.cell.is_string_like() {
                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                        tag, writer.ctx, data, self.global_this,
                                    )?;
                                } else {
                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                        tag, writer.ctx, data, self.global_this,
                                    )?;
                                }
                                writer.write_all(b", \n");
                            }
                            EventType::ErrorEvent => {
                                if let Some(data) =
                                    value.fast_get(self.global_this, jsc::BuiltinName::Error)?
                                {
                                    self.write_indent(writer.ctx).expect("unreachable");
                                    writer.print(format_args!(
                                        "{}error{}:{} ",
                                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                    ));

                                    let tag = Tag::get(data, self.global_this)?;
                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                        tag, writer.ctx, data, self.global_this,
                                    )?;
                                    writer.write_all(b"\n");
                                }
                            }
                            _ => unreachable!(),
                        }

                        self.quote_strings = old_quote_strings;
                        self.indent = self.indent.saturating_sub(1);
                    }

                    self.write_indent(writer.ctx).expect("unreachable");
                    writer.write_all(b"}");
                }
                Tag::JSX => {
                    writer.write_all(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>").as_bytes());

                    writer.write_all(b"<");

                    let mut needs_space = false;
                    let mut tag_name_str = ZigString::init(b"");

                    let mut tag_name_slice: ZigString::Slice = ZigString::Slice::EMPTY;
                    let mut is_tag_kind_primitive = false;

                    // PORT NOTE: defer if (tag_name_slice.isAllocated()) tag_name_slice.deinit()
                    // — ZigString::Slice has Drop in Rust.

                    if let Some(type_value) = value.get(self.global_this, "type")? {
                        let _tag = Tag::get(type_value, self.global_this)?;

                        if _tag.cell == JSType::Symbol {
                        } else if _tag.cell.is_string_like() {
                            type_value.to_zig_string(&mut tag_name_str, self.global_this)?;
                            is_tag_kind_primitive = true;
                        } else if _tag.cell.is_object() || type_value.is_callable() {
                            type_value.get_name_property(self.global_this, &mut tag_name_str)?;
                            if tag_name_str.len == 0 {
                                tag_name_str = ZigString::init(b"NoName");
                            }
                        } else {
                            type_value.to_zig_string(&mut tag_name_str, self.global_this)?;
                        }

                        tag_name_slice = tag_name_str.to_slice();
                        needs_space = true;
                    } else {
                        tag_name_slice = ZigString::init(b"unknown").to_slice();

                        needs_space = true;
                    }

                    if !is_tag_kind_primitive {
                        writer.write_all(
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<cyan>").as_bytes(),
                        );
                    } else {
                        writer.write_all(
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<green>").as_bytes(),
                        );
                    }
                    writer.write_all(tag_name_slice.slice());
                    if ENABLE_ANSI_COLORS {
                        writer.write_all(
                            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>").as_bytes(),
                        );
                    }

                    if let Some(key_value) = value.get(self.global_this, "key")? {
                        if !key_value.is_undefined_or_null() {
                            if needs_space {
                                writer.write_all(b" key=");
                            } else {
                                writer.write_all(b"key=");
                            }

                            let old_quote_strings = self.quote_strings;
                            self.quote_strings = true;

                            self.format::<W, ENABLE_ANSI_COLORS>(
                                Tag::get(key_value, self.global_this)?,
                                writer.ctx,
                                key_value,
                                self.global_this,
                            )?;

                            self.quote_strings = old_quote_strings;
                            needs_space = true;
                        }
                    }

                    if let Some(props) = value.get(self.global_this, "props")? {
                        let prev_quote_strings = self.quote_strings;
                        self.quote_strings = true;

                        // SAFETY: JSX props are always an object.
                        let props_obj = props.get_object().unwrap();
                        let mut props_iter = JSPropertyIterator::init(
                            self.global_this,
                            props_obj,
                            jsc::PropertyIteratorOptions {
                                skip_empty_name: true,
                                include_value: true,
                            },
                        )?;

                        let children_prop = props.get(self.global_this, "children")?;
                        if props_iter.len > 0 {
                            {
                                self.indent += 1;
                                let count_without_children =
                                    props_iter.len - usize::from(children_prop.is_some());

                                while let Some(prop) = props_iter.next()? {
                                    if prop.eql_comptime(b"children") {
                                        continue;
                                    }

                                    let property_value = props_iter.value;
                                    let tag = Tag::get(property_value, self.global_this)?;

                                    if tag.cell.is_hidden() {
                                        continue;
                                    }

                                    if needs_space {
                                        writer.write_all(b" ");
                                    }
                                    needs_space = false;

                                    writer.print(format_args!(
                                        "{}{}{}={}",
                                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                        prop.trunc(128),
                                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<d>"),
                                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
                                    ));

                                    if tag.cell.is_string_like() {
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                Output::pretty_fmt::<true>("<r><green>").as_bytes(),
                                            );
                                        }
                                    }

                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                        tag, writer.ctx, property_value, self.global_this,
                                    )?;

                                    if tag.cell.is_string_like() {
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                Output::pretty_fmt::<true>("<r>").as_bytes(),
                                            );
                                        }
                                    }

                                    if
                                    // count_without_children is necessary to prevent printing an extra newline
                                    // if there are children and one prop and the child prop is the last prop
                                    props_iter.i + 1 < count_without_children
                                        // 3 is arbitrary but basically
                                        //  <input type="text" value="foo" />
                                        //  ^ should be one line
                                        // <input type="text" value="foo" bar="true" baz={false} />
                                        //  ^ should be multiple lines
                                        && props_iter.i > 3
                                    {
                                        writer.write_all(b"\n");
                                        self.write_indent(writer.ctx).expect("unreachable");
                                    } else if props_iter.i + 1 < count_without_children {
                                        writer.write_all(b" ");
                                    }
                                }
                                self.indent = self.indent.saturating_sub(1);
                            }

                            if let Some(children) = children_prop {
                                let tag = Tag::get(children, self.global_this)?;

                                let print_children =
                                    matches!(tag.tag, Tag::String | Tag::JSX | Tag::Array);

                                if print_children {
                                    'print_children: {
                                        match tag.tag {
                                            Tag::String => {
                                                let children_string =
                                                    children.get_zig_string(self.global_this)?;
                                                if children_string.len == 0 {
                                                    break 'print_children;
                                                }
                                                if ENABLE_ANSI_COLORS {
                                                    writer.write_all(
                                                        Output::pretty_fmt::<true>("<r>").as_bytes(),
                                                    );
                                                }

                                                writer.write_all(b">");
                                                if children_string.len < 128 {
                                                    writer.write_string(children_string);
                                                } else {
                                                    self.indent += 1;
                                                    writer.write_all(b"\n");
                                                    self.write_indent(writer.ctx)
                                                        .expect("unreachable");
                                                    self.indent = self.indent.saturating_sub(1);
                                                    writer.write_string(children_string);
                                                    writer.write_all(b"\n");
                                                    self.write_indent(writer.ctx)
                                                        .expect("unreachable");
                                                }
                                            }
                                            Tag::JSX => {
                                                writer.write_all(b">\n");

                                                {
                                                    self.indent += 1;
                                                    self.write_indent(writer.ctx)
                                                        .expect("unreachable");
                                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                                        Tag::get(children, self.global_this)?,
                                                        writer.ctx,
                                                        children,
                                                        self.global_this,
                                                    )?;
                                                    self.indent = self.indent.saturating_sub(1);
                                                }

                                                writer.write_all(b"\n");
                                                self.write_indent(writer.ctx)
                                                    .expect("unreachable");
                                            }
                                            Tag::Array => {
                                                let length =
                                                    children.get_length(self.global_this)?;
                                                if length == 0 {
                                                    break 'print_children;
                                                }
                                                writer.write_all(b">\n");

                                                {
                                                    self.indent += 1;
                                                    self.write_indent(writer.ctx)
                                                        .expect("unreachable");
                                                    let _prev_quote_strings = self.quote_strings;
                                                    self.quote_strings = false;

                                                    let mut j: usize = 0;
                                                    while j < length {
                                                        let child = JSObject::get_index(
                                                            children,
                                                            self.global_this,
                                                            u32::try_from(j).unwrap(),
                                                        )?;
                                                        self.format::<W, ENABLE_ANSI_COLORS>(
                                                            Tag::get(child, self.global_this)?,
                                                            writer.ctx,
                                                            child,
                                                            self.global_this,
                                                        )?;
                                                        if j + 1 < length {
                                                            writer.write_all(b"\n");
                                                            self.write_indent(writer.ctx)
                                                                .expect("unreachable");
                                                        }
                                                        j += 1;
                                                    }

                                                    self.quote_strings = _prev_quote_strings;
                                                    self.indent = self.indent.saturating_sub(1);
                                                }

                                                writer.write_all(b"\n");
                                                self.write_indent(writer.ctx)
                                                    .expect("unreachable");
                                            }
                                            _ => unreachable!(),
                                        }

                                        writer.write_all(b"</");
                                        if !is_tag_kind_primitive {
                                            writer.write_all(
                                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                                                    "<r><cyan>",
                                                )
                                                .as_bytes(),
                                            );
                                        } else {
                                            writer.write_all(
                                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                                                    "<r><green>",
                                                )
                                                .as_bytes(),
                                            );
                                        }
                                        writer.write_all(tag_name_slice.slice());
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>")
                                                    .as_bytes(),
                                            );
                                        }
                                        writer.write_all(b">");
                                    }

                                    self.quote_strings = prev_quote_strings;
                                    return Ok(());
                                }
                            }
                        }
                        self.quote_strings = prev_quote_strings;
                    }

                    writer.write_all(b" />");
                }
                Tag::Object => {
                    let prev_quote_strings = self.quote_strings;
                    self.quote_strings = true;

                    // We want to figure out if we should print this object
                    // on one line or multiple lines
                    //
                    // The 100% correct way would be to print everything to
                    // a temporary buffer and then check how long each line was
                    //
                    // But it's important that console.log() is fast. So we
                    // do a small compromise to avoid multiple passes over input
                    //
                    // We say:
                    //
                    //   If the object has at least 2 properties and ANY of the following conditions are met:
                    //      - total length of all the property names is more than
                    //        14 characters
                    //     - the parent object is printing each property on a new line
                    //     - The first property is a DOM object, ESM namespace, Map, Set, or Blob
                    //
                    //   Then, we print it each property on a new line, recursively.
                    //
                    let prev_always_newline_scope = self.always_newline_scope;
                    let always_newline =
                        self.always_newline_scope || self.good_time_for_a_new_line();
                    let mut iter = PropertyIterator::<W, ENABLE_ANSI_COLORS> {
                        formatter: self,
                        writer: writer.ctx,
                        i: 0,
                        always_newline,
                        parent: value,
                    };

                    // TODO(port): borrowck conflict — iter borrows self & writer.ctx mutably.
                    value.for_each_property_ordered(
                        self.global_this,
                        &mut iter as *mut _ as *mut c_void,
                        PropertyIterator::<W, ENABLE_ANSI_COLORS>::for_each,
                    )?;

                    let iter_i = iter.i;
                    let iter_always_newline = iter.always_newline;
                    self.always_newline_scope = prev_always_newline_scope;
                    self.quote_strings = prev_quote_strings;

                    if iter_i == 0 {
                        let mut object_name = ZigString::EMPTY;
                        value.get_class_name(self.global_this, &mut object_name)?;

                        if !object_name.eql_comptime(b"Object") {
                            writer.print(format_args!("{} {{}}", object_name));
                        } else {
                            // don't write "Object"
                            writer.write_all(b"{}");
                        }
                    } else {
                        self.print_comma::<W, ENABLE_ANSI_COLORS>(writer.ctx)
                            .expect("unreachable");

                        if iter_always_newline {
                            self.indent = self.indent.saturating_sub(1);
                            writer.write_all(b"\n");
                            let _ = self.write_indent(writer.ctx);
                            writer.write_all(b"}");
                            self.estimated_line_length += 1;
                        } else {
                            self.estimated_line_length += 2;
                            writer.write_all(b" }");
                        }

                        if self.indent == 0 {
                            writer.write_all(b"\n");
                        }
                    }
                }
                Tag::TypedArray => {
                    let array_buffer = value.as_array_buffer(self.global_this).unwrap();
                    let slice = array_buffer.byte_slice();

                    if self.indent == 0 && !slice.is_empty() {
                        writer.write_all(b"\n");
                    }

                    if js_type == JSType::Uint8Array {
                        let mut buffer_name = ZigString::EMPTY;
                        value.get_class_name(self.global_this, &mut buffer_name)?;
                        if buffer_name.slice() == b"Buffer" {
                            // special formatting for 'Buffer' snapshots only
                            if slice.is_empty() && self.indent == 0 {
                                writer.write_all(b"\n");
                            }
                            writer.write_all(b"{\n");
                            self.indent += 1;
                            let _ = self.write_indent(writer.ctx);
                            writer.write_all(b"\"data\": [");

                            self.indent += 1;
                            for el in slice {
                                writer.write_all(b"\n");
                                let _ = self.write_indent(writer.ctx);
                                writer.print(format_args!("{},", el));
                            }
                            self.indent = self.indent.saturating_sub(1);

                            if !slice.is_empty() {
                                writer.write_all(b"\n");
                                let _ = self.write_indent(writer.ctx);
                                writer.write_all(b"],\n");
                            } else {
                                writer.write_all(b"],\n");
                            }

                            let _ = self.write_indent(writer.ctx);
                            writer.write_all(b"\"type\": \"Buffer\",\n");

                            self.indent = self.indent.saturating_sub(1);
                            let _ = self.write_indent(writer.ctx);
                            writer.write_all(b"}");

                            if self.indent == 0 {
                                writer.write_all(b"\n");
                            }

                            return Ok(());
                        }
                        writer.write_all(
                            <&'static str>::from(array_buffer.typed_array_type).as_bytes(),
                        );
                    } else {
                        writer.write_all(
                            <&'static str>::from(array_buffer.typed_array_type).as_bytes(),
                        );
                    }

                    writer.write_all(b" [");

                    macro_rules! print_typed_slice {
                        ($t:ty) => {{
                            // SAFETY: array buffer bytes are aligned to the element type by JSC.
                            let slice_with_type: &[$t] = unsafe {
                                core::slice::from_raw_parts(
                                    slice.as_ptr().cast::<$t>(),
                                    slice.len() / core::mem::size_of::<$t>(),
                                )
                            };
                            self.indent += 1;
                            for el in slice_with_type {
                                writer.write_all(b"\n");
                                let _ = self.write_indent(writer.ctx);
                                writer.print(format_args!("{},", el));
                            }
                            self.indent = self.indent.saturating_sub(1);
                        }};
                    }

                    if !slice.is_empty() {
                        match js_type {
                            JSType::Int8Array => print_typed_slice!(i8),
                            JSType::Int16Array => print_typed_slice!(i16),
                            JSType::Uint16Array => print_typed_slice!(u16),
                            JSType::Int32Array => print_typed_slice!(i32),
                            JSType::Uint32Array => print_typed_slice!(u32),
                            // TODO(port): Rust has no native f16; use bun_core::f16 or half crate.
                            JSType::Float16Array => print_typed_slice!(bun_core::f16),
                            JSType::Float32Array => print_typed_slice!(f32),
                            JSType::Float64Array => print_typed_slice!(f64),
                            JSType::BigInt64Array => print_typed_slice!(i64),
                            JSType::BigUint64Array => print_typed_slice!(u64),

                            // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
                            _ => print_typed_slice!(u8),
                        }
                    }

                    if !slice.is_empty() {
                        writer.write_all(b"\n");
                        let _ = self.write_indent(writer.ctx);
                        writer.write_all(b"]");
                        if self.indent == 0 {
                            writer.write_all(b"\n");
                        }
                    } else {
                        writer.write_all(b"]");
                    }
                }
                _ => {}
            }

            Ok(())
        })();

        if FORMAT.can_have_circular_references() {
            let _ = self.map.remove(&value);
        }
        if writer.failed {
            self.failed = true;
        }
        result
    }

    pub fn format<W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        result: TagResult,
        writer: &mut W,
        value: JSValue,
        global_this: &'a JSGlobalObject,
    ) -> JsResult<()> {
        let prev_global_this = self.global_this;
        // PORT NOTE: defer this.globalThis = prevGlobalThis — restored at end.
        self.global_this = global_this;

        // This looks incredibly redundant. We make the JestPrettyFormat.Formatter.Tag a
        // comptime var so we have to repeat it here. The rationale there is
        // it _should_ limit the stack usage because each version of the
        // function will be relatively small
        let r = match result.tag {
            Tag::StringPossiblyFormatted => self
                .print_as::<W, { Tag::StringPossiblyFormatted }, ENABLE_ANSI_COLORS>(
                    writer, value, result.cell,
                ),
            Tag::String => {
                self.print_as::<W, { Tag::String }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Undefined => self
                .print_as::<W, { Tag::Undefined }, ENABLE_ANSI_COLORS>(writer, value, result.cell),
            Tag::Double => {
                self.print_as::<W, { Tag::Double }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Integer => {
                self.print_as::<W, { Tag::Integer }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Null => {
                self.print_as::<W, { Tag::Null }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Boolean => {
                self.print_as::<W, { Tag::Boolean }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Array => {
                self.print_as::<W, { Tag::Array }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Object => {
                self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Function => self
                .print_as::<W, { Tag::Function }, ENABLE_ANSI_COLORS>(writer, value, result.cell),
            Tag::Class => {
                self.print_as::<W, { Tag::Class }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Error => {
                self.print_as::<W, { Tag::Error }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::ArrayBuffer | Tag::TypedArray => self
                .print_as::<W, { Tag::TypedArray }, ENABLE_ANSI_COLORS>(writer, value, result.cell),
            Tag::Map => {
                self.print_as::<W, { Tag::Map }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Set => {
                self.print_as::<W, { Tag::Set }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Symbol => {
                self.print_as::<W, { Tag::Symbol }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::BigInt => {
                self.print_as::<W, { Tag::BigInt }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::GlobalObject => self
                .print_as::<W, { Tag::GlobalObject }, ENABLE_ANSI_COLORS>(
                    writer, value, result.cell,
                ),
            Tag::Private => {
                self.print_as::<W, { Tag::Private }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Promise => {
                self.print_as::<W, { Tag::Promise }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::JSON => {
                self.print_as::<W, { Tag::JSON }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::NativeCode => self
                .print_as::<W, { Tag::NativeCode }, ENABLE_ANSI_COLORS>(writer, value, result.cell),
            Tag::JSX => {
                self.print_as::<W, { Tag::JSX }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
            Tag::Event => {
                self.print_as::<W, { Tag::Event }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
            }
        };
        self.global_this = prev_global_this;
        r
    }
}

impl JestPrettyFormat {
    fn print_asymmetric_matcher_promise_prefix<W: bun_io::Write>(
        flags: expect::ExpectFlags,
        matcher: &mut Formatter<'_>,
        writer: &mut WrappedWriter<'_, W>,
    ) {
        if flags.promise != expect::PromiseFlag::None {
            match flags.promise {
                expect::PromiseFlag::Resolves => {
                    matcher.add_for_new_line(b"promise resolved to ".len());
                    writer.write_all(b"promise resolved to ");
                }
                expect::PromiseFlag::Rejects => {
                    matcher.add_for_new_line(b"promise rejected to ".len());
                    writer.write_all(b"promise rejected to ");
                }
                _ => {}
            }
        }
    }

    pub fn print_asymmetric_matcher<
        W: bun_io::Write,
        const FORMAT: Tag,
        const ENABLE_ANSI_COLORS: bool,
    >(
        // the Formatter instance
        this: &mut Formatter<'_>,
        /// The WrappedWriter
        writer: &mut WrappedWriter<'_, W>,
        /// The raw writer
        writer_: &mut W,
        /// Buf used to print strings
        name_buf: [u8; 512],
        value: JSValue,
    ) -> JsResult<bool> {
        let _ = FORMAT;
        // TODO(port): `writer` and `writer_` alias the same underlying writer in Zig
        // (writer wraps writer_). Phase B: pass only `writer_` and rebuild wrapper.

        if let Some(matcher) = value.as_::<expect::ExpectAnything>() {
            Self::print_asymmetric_matcher_promise_prefix(matcher.flags, this, writer);
            if matcher.flags.not {
                this.add_for_new_line(b"NotAnything".len());
                writer.write_all(b"NotAnything");
            } else {
                this.add_for_new_line(b"Anything".len());
                writer.write_all(b"Anything");
            }
        } else if let Some(matcher) = value.as_::<expect::ExpectAny>() {
            let Some(constructor_value) = expect::ExpectAny::js::constructor_value_get_cached(value)
            else {
                return Ok(true);
            };

            Self::print_asymmetric_matcher_promise_prefix(matcher.flags, this, writer);
            if matcher.flags.not {
                this.add_for_new_line(b"NotAny<".len());
                writer.write_all(b"NotAny<");
            } else {
                this.add_for_new_line(b"Any<".len());
                writer.write_all(b"Any<");
            }

            let mut class_name = ZigString::init(&name_buf);
            constructor_value.get_class_name(this.global_this, &mut class_name)?;
            this.add_for_new_line(class_name.len);
            writer.print(format_args!(
                "{}{}{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<cyan>"),
                class_name,
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>"),
            ));
            this.add_for_new_line(1);
            writer.write_all(b">");
        } else if let Some(matcher) = value.as_::<expect::ExpectCloseTo>() {
            let Some(number_value) = expect::ExpectCloseTo::js::number_value_get_cached(value)
            else {
                return Ok(true);
            };
            let Some(digits_value) = expect::ExpectCloseTo::js::digits_value_get_cached(value)
            else {
                return Ok(true);
            };

            let number = number_value.to_int32();
            let digits = digits_value.to_int32();

            Self::print_asymmetric_matcher_promise_prefix(matcher.flags, this, writer);
            if matcher.flags.not {
                this.add_for_new_line(b"NumberNotCloseTo".len());
                writer.write_all(b"NumberNotCloseTo");
            } else {
                this.add_for_new_line(b"NumberCloseTo ".len());
                writer.write_all(b"NumberCloseTo ");
            }
            writer.print(format_args!(
                "{} ({} digit{})",
                number,
                digits,
                if digits == 1 { "" } else { "s" },
            ));
        } else if let Some(matcher) = value.as_::<expect::ExpectObjectContaining>() {
            let Some(object_value) =
                expect::ExpectObjectContaining::js::object_value_get_cached(value)
            else {
                return Ok(true);
            };

            Self::print_asymmetric_matcher_promise_prefix(matcher.flags, this, writer);
            if matcher.flags.not {
                this.add_for_new_line(b"ObjectNotContaining ".len());
                writer.write_all(b"ObjectNotContaining ");
            } else {
                this.add_for_new_line(b"ObjectContaining ".len());
                writer.write_all(b"ObjectContaining ");
            }
            this.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                writer_, object_value, JSType::Object,
            )?;
        } else if let Some(matcher) = value.as_::<expect::ExpectStringContaining>() {
            let Some(substring_value) =
                expect::ExpectStringContaining::js::string_value_get_cached(value)
            else {
                return Ok(true);
            };

            Self::print_asymmetric_matcher_promise_prefix(matcher.flags, this, writer);
            if matcher.flags.not {
                this.add_for_new_line(b"StringNotContaining ".len());
                writer.write_all(b"StringNotContaining ");
            } else {
                this.add_for_new_line(b"StringContaining ".len());
                writer.write_all(b"StringContaining ");
            }
            this.print_as::<W, { Tag::String }, ENABLE_ANSI_COLORS>(
                writer_, substring_value, JSType::String,
            )?;
        } else if let Some(matcher) = value.as_::<expect::ExpectStringMatching>() {
            let Some(test_value) = expect::ExpectStringMatching::js::test_value_get_cached(value)
            else {
                return Ok(true);
            };

            Self::print_asymmetric_matcher_promise_prefix(matcher.flags, this, writer);
            if matcher.flags.not {
                this.add_for_new_line(b"StringNotMatching ".len());
                writer.write_all(b"StringNotMatching ");
            } else {
                this.add_for_new_line(b"StringMatching ".len());
                writer.write_all(b"StringMatching ");
            }

            let original_quote_strings = this.quote_strings;
            if test_value.is_reg_exp() {
                this.quote_strings = false;
            }
            this.print_as::<W, { Tag::String }, ENABLE_ANSI_COLORS>(
                writer_, test_value, JSType::String,
            )?;
            this.quote_strings = original_quote_strings;
        } else if let Some(instance) = value.as_::<expect::ExpectCustomAsymmetricMatcher>() {
            let printed = instance
                .custom_print(value, this.global_this, writer_, true)
                .expect("unreachable");
            if !printed {
                // default print (non-overridden by user)
                let flags = instance.flags;
                let Some(args_value) =
                    expect::ExpectCustomAsymmetricMatcher::js::captured_args_get_cached(value)
                else {
                    return Ok(true);
                };
                let Some(matcher_fn) =
                    expect::ExpectCustomAsymmetricMatcher::js::matcher_fn_get_cached(value)
                else {
                    return Ok(true);
                };
                let matcher_name = matcher_fn.get_name(this.global_this)?;

                Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
                if flags.not {
                    this.add_for_new_line(b"not ".len());
                    writer.write_all(b"not ");
                }
                this.add_for_new_line(matcher_name.length() + 1);
                writer.print(format_args!("{}", matcher_name));
                writer.write_all(b" ");
                this.print_as::<W, { Tag::Array }, ENABLE_ANSI_COLORS>(
                    writer_, args_value, JSType::Array,
                )?;
            }
        } else {
            return Ok(false);
        }
        Ok(true)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/pretty_format.zig (2144 lines)
//   confidence: medium
//   todos:      18
//   notes:      Heavy borrowck reshaping needed (WrappedWriter aliases writer_/self); Output::pretty_fmt assumed const-generic; visited::Pool needs RAII guard; ZigFormatter Display has &self→&mut UB; bun_io::Write adapter for fmt::Formatter needed.
// ──────────────────────────────────────────────────────────────────────────
