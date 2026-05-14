use core::cell::{Cell, RefCell};
#[allow(unused_imports)] use crate::test_runner::expect::{JSValueTestExt, JSGlobalObjectTestExt, make_formatter};
use core::ffi::c_void;
use bun_io::Write as _;

use bun_collections::HashMap;
use bun_core::{fmt as bun_fmt, Output};
use bun_jsc::{
    self as jsc, CallFrame, ComptimeStringMapExt as _, JSGlobalObject, JSObject,
    JSPropertyIterator, JSType, JSValue, JsError, JsResult, VM,
};
use bun_js_parser::js_lexer as JSLexer;
use bun_core::{strings, ZigString, ZigStringSlice};

use super::expect;
use crate::webcore::BlobExt as _;

/// Local shim over `Output::pretty_fmt` that (a) accepts the const-generic
/// `ENABLE_ANSI_COLORS` form the Phase-A draft was written against and
/// (b) returns a value that is `Display`, `Deref<Target=[u8]>`, *and* has an
/// `.as_bytes()` method — covering all three call shapes in this file
/// (`format_args!("{}", …)`, `writer.write_all(&…)`, `….as_bytes()`).
#[inline]
fn pretty_fmt_const<const ENABLE_ANSI_COLORS: bool>(s: &str) -> PrettyStr {
    PrettyStr(Output::pretty_fmt_rt(s, ENABLE_ANSI_COLORS).0)
}
#[repr(transparent)]
pub struct PrettyStr(Vec<u8>);
impl PrettyStr {
    #[inline] pub fn as_bytes(&self) -> &[u8] { &self.0 }
}
impl core::ops::Deref for PrettyStr {
    type Target = [u8];
    #[inline] fn deref(&self) -> &[u8] { &self.0 }
}
impl AsRef<[u8]> for PrettyStr {
    #[inline] fn as_ref(&self) -> &[u8] { &self.0 }
}
impl core::fmt::Display for PrettyStr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // SAFETY: pretty_fmt output is ASCII/ANSI escape bytes (valid UTF-8).
        f.write_str(unsafe { core::str::from_utf8_unchecked(&self.0) })
    }
}

use bun_jsc::c_api::{JSObjectGetPropertyAtIndex, JSObjectGetProxyTarget};

/// `Expect*.js.*GetCached` accessors (Zig: `ExpectAny.js.constructorValueGetCached` etc.)
/// — generate-classes.ts emits these per-type for `cache: true` props
/// (jest.classes.ts). The Rust port has no inherent associated modules, so each
/// matcher gets a sibling `expect_js::*` module the same way `mod.rs` does for
/// `Expect`.
mod expect_js {
    pub mod any {
        ::bun_jsc::codegen_cached_accessors!("ExpectAny"; constructorValue);
    }
    pub mod close_to {
        ::bun_jsc::codegen_cached_accessors!("ExpectCloseTo"; numberValue, digitsValue);
    }
    pub mod object_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectObjectContaining"; objectValue);
    }
    pub mod string_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectStringContaining"; stringValue);
    }
    pub mod string_matching {
        ::bun_jsc::codegen_cached_accessors!("ExpectStringMatching"; testValue);
    }
    pub mod custom {
        ::bun_jsc::codegen_cached_accessors!("ExpectCustomAsymmetricMatcher"; capturedArgs, matcherFn);
    }
}

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
        // (.zig:79-85). Realized as `impl Drop for Formatter` below — the pool
        // node is acquired lazily inside `print_as` and swapped back on every
        // exit path of this function (early return, `?` propagation, happy path).

        if len == 1 {
            fmt = Formatter::new(global);
            fmt.quote_strings = options.quote_strings;
            let tag = Tag::get(vals[0], global)?;

            if tag.tag == Tag::String {
                if options.enable_colors {
                    if level == MessageLevel::Error {
                        let _ = writer.write_all(&pretty_fmt_const::<true>("<r><red>"));
                    }
                    fmt.format::<W, true>(tag, writer, vals[0], global)?;
                    if level == MessageLevel::Error {
                        let _ = writer.write_all(&pretty_fmt_const::<true>("<r>"));
                    }
                } else {
                    fmt.format::<W, false>(tag, writer, vals[0], global)?;
                }
                if options.add_newline {
                    let _ = writer.write_all(b"\n");
                }
            } else {
                // Zig: `defer { if (options.flush) writer.flush() catch {} }`
                // (.zig:123-125) — fires on `try` propagation too. Wrap the
                // fallible body and flush before bubbling the result.
                let result: JsResult<()> = (|| {
                    if options.enable_colors {
                        fmt.format::<W, true>(tag, writer, vals[0], global)?;
                    } else {
                        fmt.format::<W, false>(tag, writer, vals[0], global)?;
                    }
                    if options.add_newline {
                        let _ = writer.write_all(b"\n");
                    }
                    Ok(())
                })();
                if options.flush {
                    let _ = writer.flush();
                }
                result?;
            }

            let _ = writer.flush();
            return Ok(());
        }

        // Zig: `defer { if (options.flush) writer.flush() catch {} }` (.zig:152-154)
        // — fires on every exit including `try` propagation from `Tag.get` /
        // `fmt.format`. Wrap the fallible body and flush before bubbling.
        fmt = Formatter::new(global);
        fmt.remaining_values = &vals[..len][1..];
        fmt.quote_strings = options.quote_strings;

        let result: JsResult<()> = (|| {
            let mut this_value: JSValue = vals[0];
            let mut tag: TagResult;
            let mut any = false;
            if options.enable_colors {
                if level == MessageLevel::Error {
                    let _ = writer.write_all(&pretty_fmt_const::<true>("<r><red>"));
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
                    let _ = writer.write_all(&pretty_fmt_const::<true>("<r>"));
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
            Ok(())
        })();

        if options.flush {
            let _ = writer.flush();
        }

        // map_node release handled by `impl Drop for Formatter`.
        result
    }
}

// For detecting circular references
pub mod visited {
    use super::*;

    // PORT NOTE: JSValue keys live on heap; safe because every visited value is also
    // on the stack frame during format() — conservative scan still sees them. Mirrors Zig 1:1.
    //
    // `HashMap<JSValue, ()>` is a foreign type, so we cannot impl the foreign
    // `ObjectPoolType` trait on it directly (orphan rule). A `#[repr(transparent)]`
    // newtype with `Deref`/`DerefMut` keeps every call site (`.clear()`,
    // `.get_or_put()`, `.remove()`, `mem::take`) unchanged. Same trick as
    // `src/http/zlib.rs::PooledMutableString`.
    #[repr(transparent)]
    #[derive(Default)]
    pub struct Map(pub HashMap<JSValue, ()>);

    impl core::ops::Deref for Map {
        type Target = HashMap<JSValue, ()>;
        #[inline]
        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }
    impl core::ops::DerefMut for Map {
        #[inline]
        fn deref_mut(&mut self) -> &mut Self::Target {
            &mut self.0
        }
    }

    // `ObjectPool<T, ..>` requires `T: ObjectPoolType`. Mirrors Zig's
    // `ObjectPool(Map, Map.init, true, 16)` — `INIT` allocates an empty map,
    // `reset` is `clearRetainingCapacity` (handled by callers via `.clear()`).
    impl bun_collections::pool::ObjectPoolType for Map {
        const INIT: Option<fn() -> Result<Self, bun_core::Error>> =
            Some(|| Ok(Map::default()));
        #[inline]
        fn reset(&mut self) {
            self.0.clear();
        }
    }

    // Mirrors Zig's `ObjectPool(Map, Map.init, true, 16)` — thread-local free
    // list, capped at 16 nodes. `object_pool!` wires the per-monomorphization
    // storage; without it `ObjectPool<Map, true, 16>` defaults to
    // `UnwiredStorage` which panics on first `get_node()`.
    bun_collections::object_pool!(pub Pool: Map, threadsafe, 16);
    pub type PoolNode = <Pool as bun_collections::pool::ObjectPoolTrait>::Node;
}

pub struct Formatter<'a> {
    pub remaining_values: &'a [JSValue],
    pub map: visited::Map,
    /// Lazily acquired from `visited::Pool`; released back in `Drop`.
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

// Mirrors the top-level Zig defer in `JestPrettyFormat.format` (.zig:79-85):
// `defer { if (fmt.map_node) |node| { node.data = fmt.map; node.data.clearRetainingCapacity(); node.release(); } }`
// The node is acquired lazily inside `print_as` via `visited::Pool::get_node()`;
// releasing here covers every exit path of `format` (early `len == 1` return,
// `?` propagation from `Tag::get`/`fmt.format`, and the happy path) without
// the borrow-aliasing a `scopeguard` would introduce.
impl Drop for Formatter<'_> {
    fn drop(&mut self) {
        if let Some(node) = self.map_node.take() {
            // SAFETY: `node` came from `visited::Pool::get_node()` and is
            // exclusively owned for this `Formatter`'s lifetime; its `data` was
            // initialized by `Map::INIT`, so `assume_init_mut` observes a valid
            // `Map`.
            unsafe {
                let data = (*node.as_ptr()).data.assume_init_mut();
                *data = core::mem::take(&mut self.map);
                data.clear();
                visited::Pool::release(node.as_ptr());
            }
        }
    }
}

/// `Display` adapter equivalent to Zig's `JestPrettyFormat.Formatter.ZigFormatter`.
///
/// The Zig spec (`pretty_format.zig:243-263`) takes `self: ZigFormatter` *by
/// value* with a raw `*Formatter` field, so writing through `self.formatter.*`
/// carries no aliasing constraint. `Display::fmt` only gives us `&self`, so the
/// mutable handle is parked behind a `Cell` and moved out for the duration of
/// the call — this preserves unique-borrow provenance without the
/// `&shared → *const → *mut` cast that would be UB under Stacked Borrows.
pub struct ZigFormatter<'a, 'b> {
    pub formatter: Cell<Option<&'a mut Formatter<'b>>>,
    pub global: &'b JSGlobalObject,
    pub value: JSValue,
}

impl<'a, 'b> ZigFormatter<'a, 'b> {
    pub fn new(formatter: &'a mut Formatter<'b>, global: &'b JSGlobalObject, value: JSValue) -> Self {
        Self { formatter: Cell::new(Some(formatter)), global, value }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WriteError {
    #[error("UhOh")]
    UhOh,
}

impl core::fmt::Display for ZigFormatter<'_, '_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Move the unique `&mut Formatter` out of the cell for the body;
        // re-seat it (and clear `remaining_values`) on the way out so the
        // adapter mirrors Zig's `defer` and stays reusable.
        let formatter: &mut Formatter<'_> = self
            .formatter
            .take()
            .expect("ZigFormatter::fmt re-entered or used after consumption");

        // PORT NOTE (.zig:249): `self.formatter.remaining_values = &[_]JSValue{self.value}` —
        // assigning a stack-local slice into `Formatter<'b>` would require `'b: 'local`,
        // which borrowck rejects. The single-value path never reads `remaining_values`
        // (only `StringPossiblyFormatted` consumes it, and `ZigFormatter` always emits a
        // single tag), so leaving it `&[]` is observationally equivalent.
        formatter.remaining_values = &[];
        formatter.global_this = self.global;

        let result = (|| {
            let tag = Tag::get(self.value, self.global).map_err(|_| core::fmt::Error)?;
            // TODO(port): core::fmt::Formatter is a text sink; format() takes bun_io::Write.
            // Bridge via bun_io::FmtAdapter so ZigFormatter can write bytes through `f`.
            let mut adapter = bun_io::FmtAdapter::new(f);
            formatter
                .format::<_, false>(tag, &mut adapter, self.value, self.global)
                .map_err(|_| core::fmt::Error)
        })();

        // Mirrors Zig `defer self.formatter.remaining_values = &.{}`.
        formatter.remaining_values = &[];
        self.formatter.set(Some(formatter));
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
            // SAFETY: `value` is a GlobalProxy cell (checked above); JSC C-API
            // returns the wrapped target object (never null for a live proxy).
            return Tag::get(
                JSValue::c(unsafe { JSObjectGetProxyTarget(value.as_object_ref()) }),
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

// PORT NOTE: Zig's `CAPI.CellType` is the same enum as `JSType` (see
// ConsoleObject.rs). The C-API alias isn't re-exported yet.
type CellType = jsc::JSType;

thread_local! {
    static NAME_BUF: RefCell<[u8; 512]> = const { RefCell::new([0u8; 512]) };
}

impl<'a> Formatter<'a> {
    fn write_with_formatting<W: bun_io::Write, S, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer_: &mut W,
        slice_: S,
        global_this: &'a JSGlobalObject,
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
        // `format_utf16_type` writes through `fmt::Write`; buffer to a `String`
        // and forward bytes (UTF-16 → UTF-8 conversion is the point, so the
        // intermediate allocation is unavoidable without a `bun_io::Write` overload).
        let mut buf = String::new();
        if bun_fmt::format_utf16_type(input, &mut buf).is_err() {
            self.failed = true;
            return;
        }
        if self.ctx.write_all(buf.as_bytes()).is_err() {
            self.failed = true;
        }
    }
}

use bun_io::AsFmt;

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
        writer.write_all(&pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><d>,<r>"))?;
        self.estimated_line_length += 1;
        Ok(())
    }
}

// PORT NOTE: split lifetimes — `&'a mut Formatter<'a>` is invariant and forces
// the borrow of `self` at the call site to outlive `'a`, cascading into bogus
// borrowck errors throughout `print_as`. Using a distinct `'f` for the
// Formatter's own lifetime keeps the iter borrow local.
pub struct MapIterator<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub formatter: &'a mut Formatter<'f>,
    pub writer: &'a mut W,
}

impl<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    MapIterator<'a, 'f, W, ENABLE_ANSI_COLORS>
{
    pub extern "C" fn for_each(
        _: *mut VM,
        global_object: &JSGlobalObject,
        ctx: *mut c_void,
        next_value: JSValue,
    ) {
        // SAFETY: ctx was passed as `&mut Self as *mut c_void` by the caller of for_each.
        let Some(ctx) = (unsafe { ctx.cast::<Self>().as_mut() }) else { return };
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

pub struct SetIterator<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub formatter: &'a mut Formatter<'f>,
    pub writer: &'a mut W,
}

impl<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    SetIterator<'a, 'f, W, ENABLE_ANSI_COLORS>
{
    pub extern "C" fn for_each(
        _: *mut VM,
        global_object: &JSGlobalObject,
        ctx: *mut c_void,
        next_value: JSValue,
    ) {
        // SAFETY: ctx was passed as `&mut Self as *mut c_void` by the caller of for_each.
        let Some(ctx) = (unsafe { ctx.cast::<Self>().as_mut() }) else { return };
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

pub struct PropertyIterator<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub formatter: &'a mut Formatter<'f>,
    pub writer: &'a mut W,
    pub i: usize,
    pub always_newline: bool,
    pub parent: JSValue,
}

impl<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    PropertyIterator<'a, 'f, W, ENABLE_ANSI_COLORS>
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
        if classname.len > 0 && !classname.eql_comptime(b"Object") {
            let _ = self.writer.write_fmt(format_args!("{} ", classname));
        }

        let _ = self.writer.write_all(b"{\n");
        self.formatter.indent += 1;
        let _ = self.formatter.write_indent(self.writer);
        Ok(())
    }

    pub extern "C" fn for_each(
        global_this: &JSGlobalObject,
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
        let Some(ctx) = (unsafe { ctx_ptr.cast::<Self>().as_mut() }) else { return };
        if ctx.formatter.failed {
            return;
        }

        let Ok(tag) = Tag::get(value, global_this) else { return };

        if tag.cell.is_hidden() {
            return;
        }
        // PORT NOTE: reshaped for borrowck — `handle_first_property` needs `&mut *ctx`,
        // so the split borrows of `ctx.formatter`/`ctx.writer` are taken *after* it.
        if ctx.i == 0 {
            let parent = ctx.parent;
            if Self::handle_first_property(ctx, global_this, parent).is_err() {
                return;
            }
        } else if ctx.formatter.print_comma::<W, ENABLE_ANSI_COLORS>(&mut *ctx.writer).is_err() {
            return;
        }

        let this = &mut *ctx.formatter;
        let mut writer = WrappedWriter::new(&mut *ctx.writer);

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
            if !key.is_16_bit() && bun_ast::lexer_tables::is_latin1_identifier(key.slice()) {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    concat!("{}", "\"{}\"", "{}", ":", "{}", " "),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                    key,
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            } else if key.is_16_bit()
                && bun_ast::lexer_tables::is_latin1_identifier_u16(key.utf16_slice_aligned())
            {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    concat!("{}", "\"{}\"", "{}", ":", "{}", " "),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                    key,
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            } else if key.is_16_bit() {
                let utf16_slice = key.utf16_slice_aligned();

                this.add_for_new_line(utf16_slice.len() + 2);

                if ENABLE_ANSI_COLORS {
                    writer.write_all(pretty_fmt_const::<true>("<r><green>").as_bytes());
                }

                writer.write_all(b"\"");
                writer.write_16_bit(utf16_slice);
                writer.print(format_args!(
                    "\"{}:{} ",
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><d>"),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            } else {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    "{}{}{}:{} ",
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><green>"),
                    bun_fmt::format_json_string_latin1(key.slice()),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><d>"),
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                ));
            }
        } else {
            this.add_for_new_line(1 + b"[Symbol()]:".len() + key.len);
            writer.print(format_args!(
                "{}[{}Symbol({}){}]:{} ",
                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><d>"),
                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                key,
                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><d>"),
                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
            ));
        }

        if tag.cell.is_string_like() {
            if ENABLE_ANSI_COLORS {
                writer.write_all(pretty_fmt_const::<true>("<r><green>").as_bytes());
            }
        }

        let global_ref = this.global_this;
        if this
            .format::<W, ENABLE_ANSI_COLORS>(tag, writer.ctx, value, global_ref)
            .is_err()
        {
            ctx.i += 1;
            return;
        }

        if tag.cell.is_string_like() {
            if ENABLE_ANSI_COLORS {
                writer.write_all(pretty_fmt_const::<true>("<r>").as_bytes());
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

        if FORMAT.can_have_circular_references() {
            if self.map_node.is_none() {
                // PORT NOTE: `visited::Pool::get()` returns an RAII `PoolGuard` that
                // would release on scope exit; the Zig spec stashes the raw node on
                // `self` and releases it from `JestPrettyFormat::format`'s defer, so
                // take the raw node directly. `data` is initialized by
                // `Map::INIT` (see `visited::Map: ObjectPoolType`).
                let node = core::ptr::NonNull::new(visited::Pool::get_node())
                    .expect("ObjectPool::get_node never returns null");
                self.map_node = Some(node);
                // PORT NOTE: Zig (.zig:878-880) does a struct copy aliasing the same
                // backing buffer. Rust takes the map here and swaps it back into
                // `node.data` at release time (see JestPrettyFormat::format tail),
                // so the pooled allocation is retained across uses.
                // SAFETY: see above.
                unsafe {
                    let data = (*node.as_ptr()).data.assume_init_mut();
                    data.clear();
                    self.map = core::mem::take(data);
                }
            }

            let entry = self.map.get_or_put(value).expect("unreachable");
            if entry.found_existing {
                writer.write_all(
                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><cyan>[Circular]<r>").as_bytes(),
                );
                if writer.failed {
                    self.failed = true;
                }
                // Mirrors .zig:884-887 — return BEFORE the remove() defer is registered,
                // so the parent frame's entry stays in the map.
                return Ok(());
            }
        }

        // PORT NOTE: Zig `defer { if (Format.canHaveCircularReferences()) _ = this.map.remove(value); }`
        // (.zig:890-894) is realized by wrapping the match in a closure and unconditionally
        // calling `self.map.remove(&value)` after it returns (Ok or Err). A scopeguard
        // cannot be used here because it would hold `&mut self` across the match body.
        let result: JsResult<()> = (|| {
            match FORMAT {
                Tag::StringPossiblyFormatted => {
                    let str = value.to_slice(self.global_this)?;
                    let slice = str.slice();
                    self.add_for_new_line(slice.len());
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
                        self.reset_line();
                        writer.write_all(b"}\n");
                        self.indent = self.indent.saturating_sub(1);
                        return Ok(());
                    }

                    if self.quote_strings && js_type != JSType::RegExpObject {
                        if str.len == 0 {
                            writer.write_all(b"\"\"");
                            return Ok(());
                        }

                        if ENABLE_ANSI_COLORS {
                            writer.write_all(pretty_fmt_const::<true>("<r><green>").as_bytes());
                        }

                        let mut has_newline = false;

                        if str.index_of_any(b"\n\r").is_some() {
                            has_newline = true;
                            writer.write_all(b"\n");
                        }

                        writer.write_all(b"\"");
                        let mut remaining = str;
                        // `ZigString::char_at` returns u16; Zig's `'\\'`/`'\r'` are
                        // comptime_int so they coerce. Mirror with explicit u16
                        // consts so the match arms type-check (.zig:955-969).
                        const BACKSLASH: u16 = b'\\' as u16;
                        const CR: u16 = b'\r' as u16;
                        const LF: u16 = b'\n' as u16;
                        while let Some(i) = remaining.index_of_any(b"\\\r") {
                            match remaining.char_at(i) {
                                BACKSLASH => {
                                    writer.print(format_args!(
                                        "{}\\",
                                        remaining.substring_with_len(0, i)
                                    ));
                                    remaining = remaining.substring(i + 1);
                                }
                                CR => {
                                    if i + 1 < remaining.len
                                        && remaining.char_at(i + 1) == LF
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

                        if has_newline {
                            writer.write_all(b"\n");
                        }
                        // PORT NOTE: Zig registers the `<r>` reset as a `defer` (.zig:942-943)
                        // before the body, so it fires AFTER the trailing `\n` at .zig:975.
                        // Emit it last here to keep byte-for-byte parity with colored output.
                        if ENABLE_ANSI_COLORS {
                            writer.write_all(pretty_fmt_const::<true>("<r>").as_bytes());
                        }
                        return Ok(());
                    }

                    if js_type == JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!(
                            "{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><red>")
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
                        let buf = strings::allocate_latin1_into_utf8_with_list(
                            Vec::with_capacity(str.len),
                            0,
                            str.slice(),
                        );
                        if !buf.is_empty() {
                            writer.write_all(&buf);
                        }
                    }

                    if js_type == JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!(
                            "{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>")
                        ));
                    }
                }
                Tag::Integer => {
                    let int = value.to_int64();
                    self.add_for_new_line(bun_fmt::digit_count(int));
                    writer.print(format_args!(
                        "{}{}{}",
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                        int,
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::BigInt => {
                    let zig_str = value.get_zig_string(self.global_this)?;
                    let out_str = zig_str.slice();
                    self.add_for_new_line(out_str.len());

                    writer.print(format_args!(
                        "{}{}n{}",
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                        bstr::BStr::new(out_str),
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
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
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else if num.is_infinite() && num.is_sign_negative() {
                        self.add_for_new_line(b"-Infinity".len());
                        writer.print(format_args!(
                            "{}-Infinity{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else if num.is_nan() {
                        self.add_for_new_line(b"NaN".len());
                        writer.print(format_args!(
                            "{}NaN{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        // Zig `"{d}"` preserves the sign bit on -0; WTF::dtoa does not.
                        let mut dtoa_buf = [0u8; 124];
                        let dtoa =
                            bun_fmt::FormatDouble::dtoa_with_negative_zero(&mut dtoa_buf, num);
                        self.add_for_new_line(dtoa.len());
                        writer.write_all(
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>").as_bytes(),
                        );
                        writer.write_all(dtoa);
                        writer.write_all(
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>").as_bytes(),
                        );
                    }
                }
                Tag::Undefined => {
                    self.add_for_new_line(9);
                    writer.print(format_args!(
                        "{}undefined{}",
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><d>"),
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::Null => {
                    self.add_for_new_line(4);
                    writer.print(format_args!(
                        "{}null{}",
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>"),
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                }
                Tag::Symbol => {
                    let description = value.get_description(self.global_this);
                    self.add_for_new_line(b"Symbol".len());

                    if description.len > 0 {
                        self.add_for_new_line(description.len + b"()".len());
                        writer.print(format_args!(
                            "{}Symbol({}){}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                            description,
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}Symbol{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    }
                }
                Tag::Error => {
                    let mut classname = ZigString::EMPTY;
                    value.get_class_name(self.global_this, &mut classname)?;
                    let mut message_string = bun_core::String::empty();

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
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<cyan>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[class {}]{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<cyan>"),
                            printable,
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    }
                }
                Tag::Function => {
                    let mut printable = NAME_BUF.with_borrow(|b| ZigString::init(&b[..]));
                    value.get_name_property(self.global_this, &mut printable)?;

                    if printable.len == 0 {
                        writer.print(format_args!(
                            "{}[Function]{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<cyan>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[Function: {}]{}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<cyan>"),
                            printable,
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
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

                        // PORT NOTE: Zig registers `defer this.indent -|= 1` (.zig:1120) and
                        // `defer this.quote_strings = prev_quote_strings` (.zig:1128) so state is
                        // restored even when `Tag.get` / `format` throw. Wrap the fallible body in
                        // a closure and restore unconditionally afterward to match.
                        let inner: JsResult<()> = (|| {
                            {
                                // SAFETY: `r#ref` is a live JSObjectRef for `value`; index 0 is
                                // bounds-checked by `len > 0` in the enclosing branch. The C-API
                                // takes `*mut JSGlobalObject` by convention but never mutates it.
                                let element = JSValue::c(unsafe {
                                    JSObjectGetPropertyAtIndex(
                                        std::ptr::from_ref::<JSGlobalObject>(self.global_this).cast_mut(),
                                        r#ref,
                                        0,
                                        core::ptr::null_mut(),
                                    )
                                });
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
                                            pretty_fmt_const::<true>("<r>").as_bytes(),
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

                                // SAFETY: `i < len`, `r#ref` is the live object ref. The C-API
                                // takes `*mut JSGlobalObject` by convention but never mutates it.
                                let element = JSValue::c(unsafe {
                                    JSObjectGetPropertyAtIndex(
                                        std::ptr::from_ref::<JSGlobalObject>(self.global_this).cast_mut(),
                                        r#ref,
                                        i,
                                        core::ptr::null_mut(),
                                    )
                                });
                                let tag = Tag::get(element, self.global_this)?;

                                self.format::<W, ENABLE_ANSI_COLORS>(
                                    tag, writer.ctx, element, self.global_this,
                                )?;

                                if tag.cell.is_string_like() {
                                    if ENABLE_ANSI_COLORS {
                                        writer.write_all(
                                            pretty_fmt_const::<true>("<r>").as_bytes(),
                                        );
                                    }
                                }

                                if i == len - 1 {
                                    self.print_comma::<W, ENABLE_ANSI_COLORS>(writer.ctx)
                                        .expect("unreachable");
                                }
                                i += 1;
                            }
                            Ok(())
                        })();

                        self.quote_strings = prev_quote_strings;
                        self.indent = self.indent.saturating_sub(1);
                        inner?;
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
                    // .zig:1190-1278 — per-type `writeFormat` dispatch for Bun-native cells.
                    // Downcast via the `JsClass`/FFI hooks on each type; the `write_format`
                    // bodies re-enter this formatter through the `ConsoleFormatter` impl
                    // below for nested values, so the byte sink is wrapped in `AsFmt` (a
                    // `core::fmt::Write` view of the same writer).
                    if let Some(response) = value.as_::<crate::webcore::Response>() {
                        // SAFETY: `as_` returned non-null; the GC keeps the cell alive while
                        // `value` is on the stack (conservative scan). `write_format` does not
                        // re-enter `as_` for the same cell, so the `&mut` is unique here.
                        let response = unsafe { &mut *response };
                        let mut bridge = AsFmt::new(&mut *writer.ctx);
                        if response
                            .write_format::<_, _, ENABLE_ANSI_COLORS>(self, &mut bridge)
                            .is_err()
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(
                                    bun_core::err!("FmtError"),
                                    "failed to print Response",
                                ));
                            }
                            return Err(JsError::Thrown);
                        }
                    } else if let Some(request) = value.as_::<crate::webcore::Request>() {
                        // SAFETY: see Response branch above.
                        let request = unsafe { &mut *request };
                        let mut bridge = AsFmt::new(&mut *writer.ctx);
                        if request
                            .write_format::<_, _, ENABLE_ANSI_COLORS>(value, self, &mut bridge)
                            .is_err()
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(
                                    bun_core::err!("FmtError"),
                                    "failed to print Request",
                                ));
                            }
                            return Err(JsError::Thrown);
                        }
                        return Ok(());
                    } else if let Some(build) = value.as_::<crate::api::BuildArtifact>() {
                        // SAFETY: see Response branch above. `write_format` is
                        // `&self` post-R-2, so a shared borrow is sufficient.
                        let build = unsafe { &*build };
                        let mut bridge = AsFmt::new(&mut *writer.ctx);
                        if build
                            .write_format::<_, _, ENABLE_ANSI_COLORS>(self, &mut bridge)
                            .is_err()
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(
                                    bun_core::err!("FmtError"),
                                    "failed to print BuildArtifact",
                                ));
                            }
                            return Err(JsError::Thrown);
                        }
                    } else if let Some(blob) = value.as_::<crate::webcore::Blob>() {
                        // SAFETY: see Response branch above.
                        let blob = unsafe { &mut *blob };
                        let mut bridge = AsFmt::new(&mut *writer.ctx);
                        if blob
                            .write_format::<_, _, ENABLE_ANSI_COLORS>(self, &mut bridge)
                            .is_err()
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(
                                    bun_core::err!("FmtError"),
                                    "failed to print Blob",
                                ));
                            }
                            return Err(JsError::Thrown);
                        }
                        return Ok(());
                    } else if bun_jsc::DOMFormData::from_js(value).is_some() {
                        let to_json_function = value.get(self.global_this, "toJSON")?.unwrap();

                        self.add_for_new_line(b"FormData (entries) ".len());
                        writer.write_all(
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>(
                                "<r><blue>FormData<r> <d>(entries)<r> ",
                            )
                            .as_bytes(),
                        );

                        return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx,
                            to_json_function.call(self.global_this, value, &[])?,
                            JSType::Object,
                        );
                    } else if let Some(timer) = value.as_class_ref::<crate::timer::TimeoutObject>() {
                        self.add_for_new_line(
                            b"Timeout(# ) ".len()
                                + bun_fmt::digit_count(timer.internals.id.max(0)),
                        );
                        if timer.internals.flags.get().kind() == crate::timer::Kind::SetInterval {
                            self.add_for_new_line(
                                b"repeats ".len()
                                    + bun_fmt::digit_count(timer.internals.id.max(0)),
                            );
                            writer.print(format_args!(
                                "{}Timeout{} {}(#{}{}{}{}, repeats){}",
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<yellow>"),
                                timer.internals.id,
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                            ));
                        } else {
                            writer.print(format_args!(
                                "{}Timeout{} {}(#{}{}{}{}){}",
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<yellow>"),
                                timer.internals.id,
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                            ));
                        }

                        return Ok(());
                    } else if let Some(immediate) =
                        value.as_class_ref::<crate::timer::ImmediateObject>()
                    {
                        self.add_for_new_line(
                            b"Immediate(# ) ".len()
                                + bun_fmt::digit_count(immediate.internals.id.max(0)),
                        );
                        writer.print(format_args!(
                            "{}Immediate{} {}(#{}{}{}{}){}",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<yellow>"),
                            immediate.internals.id,
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));

                        return Ok(());
                    } else if let Some(build_log) = value.as_class_ref::<crate::api::BuildMessage>() {
                        let mut bridge = AsFmt::new(&mut *writer.ctx);
                        let _ = build_log.msg.write_format::<ENABLE_ANSI_COLORS>(&mut bridge);
                        return Ok(());
                    } else if let Some(resolve_log) = value.as_class_ref::<crate::api::ResolveMessage>() {
                        let mut bridge = AsFmt::new(&mut *writer.ctx);
                        let _ = resolve_log.msg.write_format::<ENABLE_ANSI_COLORS>(&mut bridge);
                        return Ok(());
                    } else if NAME_BUF.with_borrow(|name_buf| {
                        JestPrettyFormat::print_asymmetric_matcher::<_, W, ENABLE_ANSI_COLORS>(
                            self, &mut writer, name_buf, value,
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
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>true<r>").as_bytes(),
                        );
                    } else {
                        self.add_for_new_line(5);
                        writer.write_all(
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><yellow>false<r>").as_bytes(),
                        );
                    }
                }
                Tag::GlobalObject => {
                    const FMT: &str = "[this.globalThis]";
                    self.add_for_new_line(FMT.len());
                    writer.write_all(
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>(concat!(
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
                        // PORT NOTE: hoist global_this (Copy &ref) before iter mutably
                        // borrows `self`/`writer.ctx`; NLL releases both once `iter`
                        // is dead after `for_each` returns.
                        let global = self.global_this;
                        let mut iter = MapIterator::<W, ENABLE_ANSI_COLORS> {
                            formatter: self,
                            writer: writer.ctx,
                        };
                        let result = value.for_each(
                            global,
                            (&raw mut iter).cast::<c_void>(),
                            MapIterator::<W, ENABLE_ANSI_COLORS>::for_each,
                        );
                        drop(iter);
                        // PORT NOTE: Zig `defer this.indent -|= 1` / `defer this.quote_strings = prev`
                        // run on every exit, including thrown exceptions — restore before propagating.
                        self.indent = self.indent.saturating_sub(1);
                        self.quote_strings = prev_quote_strings;
                        result?;
                    }
                    let _ = self.write_indent(writer.ctx);
                    writer.write_all(b"}");
                    writer.write_all(b"\n");
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
                        let global = self.global_this;
                        let mut iter = SetIterator::<W, ENABLE_ANSI_COLORS> {
                            formatter: self,
                            writer: writer.ctx,
                        };
                        let result = value.for_each(
                            global,
                            (&raw mut iter).cast::<c_void>(),
                            SetIterator::<W, ENABLE_ANSI_COLORS>::for_each,
                        );
                        drop(iter);
                        // PORT NOTE: Zig `defer this.indent -|= 1` / `defer this.quote_strings = prev`
                        // run on every exit, including thrown exceptions — restore before propagating.
                        self.indent = self.indent.saturating_sub(1);
                        self.quote_strings = prev_quote_strings;
                        result?;
                    }
                    let _ = self.write_indent(writer.ctx);
                    writer.write_all(b"}");
                    writer.write_all(b"\n");
                }
                Tag::JSON => {
                    let mut str = bun_core::String::empty();

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
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><magenta>"),
                            bstr::BStr::new(out_buf),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
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
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><cyan>"),
                        <&'static str>::from(event_type),
                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                    ));
                    {
                        self.indent += 1;
                        let old_quote_strings = self.quote_strings;
                        self.quote_strings = true;
                        // PORT NOTE: Zig registers `defer this.indent -|= 1` and
                        // `defer this.quote_strings = old_quote_strings` here so state
                        // is restored even when `fastGet` / `Tag.get` / `format` throw.
                        // Wrap the fallible body and restore unconditionally afterward.
                        let inner: JsResult<()> = (|| {
                        self.write_indent(writer.ctx).expect("unreachable");

                        writer.print(format_args!(
                            "{}type: {}\"{}\"{}{},{}\n",
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<green>"),
                            bstr::BStr::new(event_type.label()),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                        ));

                        if let Some(message_value) =
                            value.fast_get(self.global_this, jsc::BuiltinName::Message)?
                        {
                            if message_value.is_string() {
                                self.write_indent(writer.ctx).expect("unreachable");
                                writer.print(format_args!(
                                    "{}message{}:{} ",
                                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
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
                                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                    pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
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
                                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
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
                        Ok(())
                        })();

                        self.quote_strings = old_quote_strings;
                        self.indent = self.indent.saturating_sub(1);
                        inner?;
                    }

                    self.write_indent(writer.ctx).expect("unreachable");
                    writer.write_all(b"}");
                }
                Tag::JSX => {
                    writer.write_all(pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>").as_bytes());

                    writer.write_all(b"<");

                    let mut needs_space = false;
                    let mut tag_name_str = ZigString::init(b"");

                    let mut tag_name_slice: ZigStringSlice = ZigStringSlice::EMPTY;
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
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<cyan>").as_bytes(),
                        );
                    } else {
                        writer.write_all(
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<green>").as_bytes(),
                        );
                    }
                    writer.write_all(tag_name_slice.slice());
                    if ENABLE_ANSI_COLORS {
                        writer.write_all(
                            pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>").as_bytes(),
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

                            let inner: JsResult<()> = (|| {
                                self.format::<W, ENABLE_ANSI_COLORS>(
                                    Tag::get(key_value, self.global_this)?,
                                    writer.ctx,
                                    key_value,
                                    self.global_this,
                                )
                            })();
                            self.quote_strings = old_quote_strings;
                            inner?;
                            needs_space = true;
                        }
                    }

                    if let Some(props) = value.get(self.global_this, "props")? {
                        let prev_quote_strings = self.quote_strings;
                        self.quote_strings = true;

                        // PORT NOTE: Zig registers `defer this.quote_strings = prev_quote_strings`
                        // (and nested `defer this.indent -|= 1` scopes) so state is restored on
                        // every exit, including thrown exceptions. Wrap the fallible body in a
                        // closure (Ok(true) ⇒ children path printed the closing tag, so the
                        // trailing " />" is skipped) and restore unconditionally afterward.
                        let inner: JsResult<bool> = (|| {
                        let Some(props_obj) = props.get_object() else { return Ok(false); };
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

                                let loop_result: JsResult<()> = (|| {
                                // PORT NOTE: `JSPropertyIterator::i` is private upstream;
                                // track the 1-based iteration index locally (matches the
                                // post-`next()` value of the Zig spec's `props_iter.i`).
                                let mut iter_i: usize = 0;
                                while let Some(prop) = props_iter.next()? {
                                    iter_i += 1;
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
                                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r><blue>"),
                                        prop.trunc(128),
                                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<d>"),
                                        pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
                                    ));

                                    if tag.cell.is_string_like() {
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                pretty_fmt_const::<true>("<r><green>").as_bytes(),
                                            );
                                        }
                                    }

                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                        tag, writer.ctx, property_value, self.global_this,
                                    )?;

                                    if tag.cell.is_string_like() {
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                pretty_fmt_const::<true>("<r>").as_bytes(),
                                            );
                                        }
                                    }

                                    if
                                    // count_without_children is necessary to prevent printing an extra newline
                                    // if there are children and one prop and the child prop is the last prop
                                    iter_i + 1 < count_without_children
                                        // 3 is arbitrary but basically
                                        //  <input type="text" value="foo" />
                                        //  ^ should be one line
                                        // <input type="text" value="foo" bar="true" baz={false} />
                                        //  ^ should be multiple lines
                                        && iter_i > 3
                                    {
                                        writer.write_all(b"\n");
                                        self.write_indent(writer.ctx).expect("unreachable");
                                    } else if iter_i + 1 < count_without_children {
                                        writer.write_all(b" ");
                                    }
                                }
                                Ok(())
                                })();
                                self.indent = self.indent.saturating_sub(1);
                                loop_result?;
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
                                                        pretty_fmt_const::<true>("<r>").as_bytes(),
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
                                                    let r: JsResult<()> = (|| {
                                                        self.write_indent(writer.ctx)
                                                            .expect("unreachable");
                                                        self.format::<W, ENABLE_ANSI_COLORS>(
                                                            Tag::get(children, self.global_this)?,
                                                            writer.ctx,
                                                            children,
                                                            self.global_this,
                                                        )
                                                    })();
                                                    self.indent = self.indent.saturating_sub(1);
                                                    r?;
                                                }

                                                writer.write_all(b"\n");
                                                self.write_indent(writer.ctx)
                                                    .expect("unreachable");
                                            }
                                            Tag::Array => {
                                                let length =
                                                    children.get_length(self.global_this)? as usize;
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

                                                    let r: JsResult<()> = (|| {
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
                                                        Ok(())
                                                    })();

                                                    self.quote_strings = _prev_quote_strings;
                                                    self.indent = self.indent.saturating_sub(1);
                                                    r?;
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
                                                pretty_fmt_const::<ENABLE_ANSI_COLORS>(
                                                    "<r><cyan>",
                                                )
                                                .as_bytes(),
                                            );
                                        } else {
                                            writer.write_all(
                                                pretty_fmt_const::<ENABLE_ANSI_COLORS>(
                                                    "<r><green>",
                                                )
                                                .as_bytes(),
                                            );
                                        }
                                        writer.write_all(tag_name_slice.slice());
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>")
                                                    .as_bytes(),
                                            );
                                        }
                                        writer.write_all(b">");
                                    }

                                    return Ok(true);
                                }
                            }
                        }
                        Ok(false)
                        })();

                        self.quote_strings = prev_quote_strings;
                        if inner? {
                            return Ok(());
                        }
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
                    let global = self.global_this;
                    let mut iter = PropertyIterator::<W, ENABLE_ANSI_COLORS> {
                        formatter: self,
                        writer: writer.ctx,
                        i: 0,
                        always_newline,
                        parent: value,
                    };

                    let result = value.for_each_property_ordered(
                        global,
                        (&raw mut iter).cast::<c_void>(),
                        PropertyIterator::<W, ENABLE_ANSI_COLORS>::for_each,
                    );

                    let iter_i = iter.i;
                    let iter_always_newline = iter.always_newline;
                    drop(iter);
                    // PORT NOTE: Zig `defer this.always_newline_scope = prev` /
                    // `defer this.quote_strings = prev` run on every exit — restore
                    // before propagating any exception from the property iterator.
                    self.always_newline_scope = prev_always_newline_scope;
                    self.quote_strings = prev_quote_strings;
                    result?;

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
                        writer.write_all(array_buffer.typed_array_type.typed_array_name());
                    } else {
                        writer.write_all(array_buffer.typed_array_type.typed_array_name());
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

/// Bridge so the `Response`/`Request`/`Blob`/`BuildArtifact` `write_format`
/// hooks (typed `F: bun_jsc::ConsoleFormatter`) can re-enter this formatter
/// for nested values. The trait is the layering seam — it lives in `bun_jsc`,
/// the webcore types call through it generically, and this file supplies the
/// test-runner-specific dispatch. Mirrors the `bun_jsc::console_object`
/// `Formatter` impl (`src/jsc/lib.rs`) one-for-one, mapping the
/// `bun_jsc::FormatTag` enum onto this file's smaller `Tag` set.
impl bun_jsc::ConsoleFormatter for Formatter<'_> {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject { self.global_this }
    #[inline]
    fn indent_inc(&mut self) { self.indent += 1; }
    #[inline]
    fn indent_dec(&mut self) { self.indent = self.indent.saturating_sub(1); }
    #[inline]
    fn reset_line(&mut self) { Formatter::reset_line(self) }
    fn write_indent<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result {
        let mut sink = bun_io::FmtAdapter::new(writer);
        Formatter::write_indent(self, &mut sink).map_err(|_| core::fmt::Error)
    }
    fn print_comma<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> core::fmt::Result {
        let mut sink = bun_io::FmtAdapter::new(writer);
        Formatter::print_comma::<_, ENABLE_ANSI_COLORS>(self, &mut sink)
            .map_err(|_| core::fmt::Error)
    }
    fn print_as<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        writer: &mut W,
        value: JSValue,
        cell: JSType,
    ) -> JsResult<()> {
        use bun_jsc::FormatTag as Ft;
        // Map the wider `console_object::Tag` onto this file's `Tag`. Only the
        // variants the `write_format` hooks actually emit are reachable
        // (Boolean / Double / Object / Private / String); the rest collapse
        // onto `Object` so any future caller still renders something useful.
        let local = match tag {
            Ft::StringPossiblyFormatted => Tag::StringPossiblyFormatted,
            Ft::String => Tag::String,
            Ft::Undefined => Tag::Undefined,
            Ft::Double => Tag::Double,
            Ft::Integer => Tag::Integer,
            Ft::Null => Tag::Null,
            Ft::Boolean => Tag::Boolean,
            Ft::Array => Tag::Array,
            Ft::Object => Tag::Object,
            Ft::Function => Tag::Function,
            Ft::Class => Tag::Class,
            Ft::Error => Tag::Error,
            Ft::TypedArray => Tag::TypedArray,
            Ft::Map => Tag::Map,
            Ft::Set => Tag::Set,
            Ft::Symbol => Tag::Symbol,
            Ft::BigInt => Tag::BigInt,
            Ft::GlobalObject => Tag::GlobalObject,
            Ft::Private => Tag::Private,
            Ft::Promise => Tag::Promise,
            Ft::JSON => Tag::JSON,
            Ft::NativeCode => Tag::NativeCode,
            Ft::JSX => Tag::JSX,
            Ft::Event => Tag::Event,
            // Variants the test-runner formatter has no dedicated arm for:
            Ft::MapIterator
            | Ft::SetIterator
            | Ft::CustomFormattedObject
            | Ft::ToJSON
            | Ft::GetterSetter
            | Ft::CustomGetterSetter
            | Ft::Proxy
            | Ft::RevokedProxy => Tag::Object,
        };
        let mut sink = bun_io::FmtAdapter::new(writer);
        let global = self.global_this;
        self.format::<_, ENABLE_ANSI_COLORS>(
            TagResult { tag: local, cell },
            &mut sink,
            value,
            global,
        )
    }
}

/// Duck-type surface that [`JestPrettyFormat::print_asymmetric_matcher`] needs
/// from a formatter. Spec `pretty_format.zig:2005` takes the formatter via
/// `anytype`, so it monomorphises over both `JestPrettyFormat.Formatter` and
/// `ConsoleObject.Formatter`. This trait is the Rust spelling of that
/// duck-typing — implemented for both [`Formatter`] (this module) and
/// [`bun_jsc::console_object::Formatter`] so the same body serves the test
/// runner *and* `console.log`'s `.Private` arm (via the
/// `RuntimeHooks::console_print_runtime_object` hook).
pub trait AsymmetricMatcherFormatter {
    fn amf_add_for_new_line(&mut self, n: usize);
    fn amf_global_this(&self) -> &JSGlobalObject;
    fn amf_quote_strings(&mut self) -> &mut bool;
    /// `printAs(tag, …)` routed through the formatter's own runtime
    /// dispatcher. Only `Object` / `String` / `Array` are reached.
    fn amf_print_as<const C: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        w: &mut dyn bun_io::Write,
        v: JSValue,
        cell: JSType,
    ) -> JsResult<()>;
}

impl AsymmetricMatcherFormatter for Formatter<'_> {
    #[inline]
    fn amf_add_for_new_line(&mut self, n: usize) { self.add_for_new_line(n); }
    #[inline]
    fn amf_global_this(&self) -> &JSGlobalObject { self.global_this }
    #[inline]
    fn amf_quote_strings(&mut self) -> &mut bool { &mut self.quote_strings }
    fn amf_print_as<const C: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        w: &mut dyn bun_io::Write,
        v: JSValue,
        cell: JSType,
    ) -> JsResult<()> {
        // Reuse the `ConsoleFormatter` bridge above (FormatTag → local `Tag`
        // mapping + `format` dispatch). `AsFmt` adapts `dyn bun_io::Write` →
        // `core::fmt::Write` for the trait method's signature.
        let mut bridge = AsFmt::new(w);
        <Self as bun_jsc::ConsoleFormatter>::print_as::<_, C>(self, tag, &mut bridge, v, cell)
    }
}

impl AsymmetricMatcherFormatter for bun_jsc::console_object::Formatter<'_> {
    #[inline]
    fn amf_add_for_new_line(&mut self, n: usize) { self.add_for_new_line(n); }
    #[inline]
    fn amf_global_this(&self) -> &JSGlobalObject { self.global_this }
    #[inline]
    fn amf_quote_strings(&mut self) -> &mut bool { &mut self.quote_strings }
    fn amf_print_as<const C: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        w: &mut dyn bun_io::Write,
        v: JSValue,
        cell: JSType,
    ) -> JsResult<()> {
        let global = self.global_this;
        self.format::<C>(
            bun_jsc::console_object::formatter::TagResult { tag: tag.into(), cell },
            w,
            v,
            global,
        )
    }
}

impl JestPrettyFormat {
    fn print_asymmetric_matcher_promise_prefix<M, W>(
        flags: expect::Flags,
        matcher: &mut M,
        writer: &mut WrappedWriter<'_, W>,
    ) where
        M: AsymmetricMatcherFormatter,
        W: bun_io::Write,
    {
        match flags.promise() {
            expect::Promise::Resolves => {
                matcher.amf_add_for_new_line(b"promise resolved to ".len());
                writer.write_all(b"promise resolved to ");
            }
            expect::Promise::Rejects => {
                matcher.amf_add_for_new_line(b"promise rejected to ".len());
                writer.write_all(b"promise rejected to ");
            }
            expect::Promise::None => {}
        }
    }

    pub fn print_asymmetric_matcher<M, W, const ENABLE_ANSI_COLORS: bool>(
        // the Formatter instance
        this: &mut M,
        // The WrappedWriter (caller's instance — `failed` propagates back)
        writer: &mut WrappedWriter<'_, W>,
        // Buf used to print strings
        name_buf: &[u8; 512],
        value: JSValue,
    ) -> JsResult<bool>
    where
        M: AsymmetricMatcherFormatter,
        W: bun_io::Write,
    {
        // PORT NOTE: Zig (.zig:2005-2013) passes both `*WrappedWriter` and the raw inner
        // writer, which alias. In Rust that would be two live `&mut W` to the same target
        // (UB / borrowck violation), so we accept only the wrapped writer and reach the
        // raw `&mut W` via `writer.ctx` for `print_as` calls — single borrow chain.

        if let Some(matcher) = value.as_class_ref::<expect::ExpectAnything>() {
            let flags = matcher.flags.get();
            Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
            if flags.not() {
                this.amf_add_for_new_line(b"NotAnything".len());
                writer.write_all(b"NotAnything");
            } else {
                this.amf_add_for_new_line(b"Anything".len());
                writer.write_all(b"Anything");
            }
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectAny>() {
            let Some(constructor_value) = expect_js::any::constructor_value_get_cached(value)
            else {
                return Ok(true);
            };

            let flags = matcher.flags.get();
            Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
            if flags.not() {
                this.amf_add_for_new_line(b"NotAny<".len());
                writer.write_all(b"NotAny<");
            } else {
                this.amf_add_for_new_line(b"Any<".len());
                writer.write_all(b"Any<");
            }

            let mut class_name = ZigString::init(name_buf);
            constructor_value.get_class_name(this.amf_global_this(), &mut class_name)?;
            this.amf_add_for_new_line(class_name.len);
            writer.print(format_args!(
                "{}{}{}",
                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<cyan>"),
                class_name,
                pretty_fmt_const::<ENABLE_ANSI_COLORS>("<r>"),
            ));
            this.amf_add_for_new_line(1);
            writer.write_all(b">");
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
            let Some(number_value) = expect_js::close_to::number_value_get_cached(value)
            else {
                return Ok(true);
            };
            let Some(digits_value) = expect_js::close_to::digits_value_get_cached(value)
            else {
                return Ok(true);
            };

            let number = number_value.to_int32();
            let digits = digits_value.to_int32();

            let flags = matcher.flags.get();
            Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
            if flags.not() {
                this.amf_add_for_new_line(b"NumberNotCloseTo".len());
                writer.write_all(b"NumberNotCloseTo");
            } else {
                this.amf_add_for_new_line(b"NumberCloseTo ".len());
                writer.write_all(b"NumberCloseTo ");
            }
            writer.print(format_args!(
                "{} ({} digit{})",
                number,
                digits,
                if digits == 1 { "" } else { "s" },
            ));
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
            let Some(object_value) =
                expect_js::object_containing::object_value_get_cached(value)
            else {
                return Ok(true);
            };

            let flags = matcher.flags.get();
            Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
            if flags.not() {
                this.amf_add_for_new_line(b"ObjectNotContaining ".len());
                writer.write_all(b"ObjectNotContaining ");
            } else {
                this.amf_add_for_new_line(b"ObjectContaining ".len());
                writer.write_all(b"ObjectContaining ");
            }
            this.amf_print_as::<ENABLE_ANSI_COLORS>(
                bun_jsc::FormatTag::Object, &mut *writer.ctx, object_value, JSType::Object,
            )?;
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
            let Some(substring_value) =
                expect_js::string_containing::string_value_get_cached(value)
            else {
                return Ok(true);
            };

            let flags = matcher.flags.get();
            Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
            if flags.not() {
                this.amf_add_for_new_line(b"StringNotContaining ".len());
                writer.write_all(b"StringNotContaining ");
            } else {
                this.amf_add_for_new_line(b"StringContaining ".len());
                writer.write_all(b"StringContaining ");
            }
            this.amf_print_as::<ENABLE_ANSI_COLORS>(
                bun_jsc::FormatTag::String, &mut *writer.ctx, substring_value, JSType::String,
            )?;
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
            let Some(test_value) = expect_js::string_matching::test_value_get_cached(value)
            else {
                return Ok(true);
            };

            let flags = matcher.flags.get();
            Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
            if flags.not() {
                this.amf_add_for_new_line(b"StringNotMatching ".len());
                writer.write_all(b"StringNotMatching ");
            } else {
                this.amf_add_for_new_line(b"StringMatching ".len());
                writer.write_all(b"StringMatching ");
            }

            let original_quote_strings = *this.amf_quote_strings();
            if test_value.is_reg_exp() {
                *this.amf_quote_strings() = false;
            }
            this.amf_print_as::<ENABLE_ANSI_COLORS>(
                bun_jsc::FormatTag::String, &mut *writer.ctx, test_value, JSType::String,
            )?;
            *this.amf_quote_strings() = original_quote_strings;
        } else if let Some(instance) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
            let printed = expect::ExpectCustomAsymmetricMatcher::custom_print(
                instance, value, this.amf_global_this(), &mut *writer.ctx, true,
            )
            .expect("unreachable");
            if !printed {
                // default print (non-overridden by user)
                let flags = instance.flags;
                let Some(args_value) =
                    expect_js::custom::captured_args_get_cached(value)
                else {
                    return Ok(true);
                };
                let Some(matcher_fn) =
                    expect_js::custom::matcher_fn_get_cached(value)
                else {
                    return Ok(true);
                };
                let matcher_name = matcher_fn.get_name(this.amf_global_this())?;

                Self::print_asymmetric_matcher_promise_prefix(flags, this, writer);
                if flags.not() {
                    this.amf_add_for_new_line(b"not ".len());
                    writer.write_all(b"not ");
                }
                this.amf_add_for_new_line(matcher_name.length() + 1);
                writer.print(format_args!("{}", matcher_name));
                writer.write_all(b" ");
                this.amf_print_as::<ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatTag::Array, &mut *writer.ctx, args_value, JSType::Array,
                )?;
            }
        } else {
            return Ok(false);
        }
        Ok(true)
    }
}

// ported from: src/test_runner/pretty_format.zig
