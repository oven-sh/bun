use crate::test_runner::expect::JSValueTestExt;
use core::ffi::c_void;

use bun_collections::HashMap;
use bun_core::fmt as bun_fmt;
use bun_jsc::{
    self as jsc, ComptimeStringMapExt as _, JSGlobalObject, JSObject,
    JSPropertyIterator, JSType, JSValue, JsClass as _, JsError, JsResult, StringJsc as _, VM,
};
use bun_core::{strings, EncodedSlice, Utf8Bytes};

use super::expect;
use super::snapshot::Format as SnapshotFormat;
use crate::webcore::BlobExt as _;

/// `<tag>` colour templates used by the formatter, rewritten to ANSI (or
/// stripped) at compile time for both colour states; the const-generic
/// `ENABLE_ANSI_COLORS` picks one.
macro_rules! pretty_fmt_const {
    ($enabled:expr, $fmt:literal) => {
        if $enabled { ::bun_core::pretty_fmt!($fmt, true) } else { ::bun_core::pretty_fmt!($fmt, false) }
    };
}

/// `Expect*.js.*GetCached` accessors — generate-classes.ts emits these
/// per-type for `cache: true` props (jest.classes.ts).
/// Rust has no inherent associated modules, so each
/// matcher gets a sibling `expect_js::*` module the same way `mod.rs` does for
/// `Expect`.
mod expect_js {
    pub(super) mod any {
        ::bun_jsc::codegen_cached_accessors!("ExpectAny"; constructorValue);
    }
    pub(super) mod array_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectArrayContaining"; arrayValue);
    }
    pub(super) mod close_to {
        ::bun_jsc::codegen_cached_accessors!("ExpectCloseTo"; numberValue, digitsValue);
    }
    pub(super) mod object_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectObjectContaining"; objectValue);
    }
    pub(super) mod string_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectStringContaining"; stringValue);
    }
    pub(super) mod string_matching {
        ::bun_jsc::codegen_cached_accessors!("ExpectStringMatching"; testValue);
    }
    pub(super) mod custom {
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
    // This variant absorbs any
    // unrecognized event name. Values are only ever constructed via the
    // EVENT_TYPE_MAP lookup below (never transmuted from a raw u8), so no
    // other catch-all is needed.
    Unknown = 254,
}

bun_core::comptime_string_map! {
    static EVENT_TYPE_MAP: EventType = {
        b"event" => EventType::Event,
        b"message" => EventType::MessageEvent,
        b"close" => EventType::CloseEvent,
        b"error" => EventType::ErrorEvent,
        b"open" => EventType::OpenEvent,
    };
}

impl EventType {
    pub(crate) fn label(self) -> &'static [u8] {
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

#[derive(Default)]
pub(crate) struct JestPrettyFormat {}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum MessageLevel {
    Error = 2,
    Debug = 3,
}

#[derive(Copy, Clone, Default)]
pub(crate) struct FormatOptions {
    pub(crate) enable_colors: bool,
    pub(crate) add_newline: bool,
    pub flush: bool,
    pub(crate) quote_strings: bool,
}

impl JestPrettyFormat {
    pub(crate) fn format<W: bun_io::Write>(
        level: MessageLevel,
        global: &JSGlobalObject,
        vals: &[JSValue],
        len: usize,
        writer: &mut W,
        options: FormatOptions,
    ) -> JsResult<()> {
        // Nested values re-enter the formatter through `ConsoleFormatter::print_as`
        // with a `FmtAdapter<AsFmt>` sink; adapt the caller's writer to that same
        // type up front so the whole `Formatter` tree is instantiated once.
        let flush = options.flush;
        let result = {
            let mut bridge = AsFmt::new(&mut *writer);
            let mut adapted = bun_io::write::FmtAdapter::new(&mut bridge);
            Self::format_adapted(level, global, vals, len, &mut adapted, options)
        };
        // `FmtAdapter::flush` can't reach `writer`; do the requested flush here.
        if flush {
            let _ = writer.flush();
        }
        result
    }

    fn format_adapted(
        level: MessageLevel,
        global: &JSGlobalObject,
        vals: &[JSValue],
        len: usize,
        writer: &mut bun_io::write::FmtAdapter<'_, AsFmt<'_>>,
        options: FormatOptions,
    ) -> JsResult<()> {
        use bun_io::Write as _;
        type W<'a, 'b> = bun_io::write::FmtAdapter<'a, AsFmt<'b>>;
        let mut fmt: Formatter;
        // `impl Drop for Formatter` below releases the pool map — the pool
        // node is acquired lazily inside `print_as` and swapped back on every
        // exit path of this function (early return, `?` propagation, happy path).

        if len == 1 {
            fmt = Formatter::new(global);
            fmt.quote_strings = options.quote_strings;
            let tag = Tag::get(vals[0], global)?;

            if tag.tag == Tag::String {
                if options.enable_colors {
                    if level == MessageLevel::Error {
                        let _ = writer.write_all(pretty_fmt_const!(true, "<r><red>").as_bytes());
                    }
                    fmt.format::<W, true>(tag, writer, vals[0], global)?;
                    if level == MessageLevel::Error {
                        let _ = writer.write_all(pretty_fmt_const!(true, "<r>").as_bytes());
                    }
                } else {
                    fmt.format::<W, false>(tag, writer, vals[0], global)?;
                }
                if options.add_newline {
                    let _ = writer.write_all(b"\n");
                }
            } else {
                // The flush must fire on `?` propagation too. Wrap the
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

        // The flush must fire on every exit including `?` propagation from
        // `Tag::get` / `fmt.format`. Wrap the fallible body and flush before bubbling.
        fmt = Formatter::new(global);
        fmt.remaining_values = &vals[..len][1..];
        fmt.quote_strings = options.quote_strings;

        let result: JsResult<()> = (|| {
            let mut this_value: JSValue = vals[0];
            let mut tag: TagResult;
            let mut any = false;
            if options.enable_colors {
                if level == MessageLevel::Error {
                    let _ = writer.write_all(pretty_fmt_const!(true, "<r><red>").as_bytes());
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
                    let _ = writer.write_all(pretty_fmt_const!(true, "<r>").as_bytes());
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
pub(crate) mod visited {
    use super::*;

    // JSValue keys live on heap; safe because every visited value is also
    // on the stack frame during format() — conservative scan still sees them.
    //
    // `HashMap<JSValue, ()>` is a foreign type, so we cannot impl the foreign
    // `ObjectPoolType` trait on it directly (orphan rule). A `#[repr(transparent)]`
    // newtype with `Deref`/`DerefMut` keeps every call site (`.clear()`,
    // `.get_or_put()`, `.remove()`, `mem::take`) unchanged.
    #[repr(transparent)]
    #[derive(Default)]
    pub(crate) struct Map(pub(crate) HashMap<JSValue, ()>);

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

    // `ObjectPool<T, ..>` requires `T: ObjectPoolType` — `INIT` allocates an empty map,
    // `reset` clears retaining capacity (handled by callers via `.clear()`).
    impl bun_collections::pool::ObjectPoolType for Map {
        const INIT: Option<fn() -> Result<Self, bun_core::Error>> =
            Some(|| Ok(Map::default()));
        #[inline]
        fn reset(&mut self) {
            self.0.clear();
        }
    }

    // Thread-local free
    // list, capped at 16 nodes. `object_pool!` wires the per-monomorphization
    // storage; without it `ObjectPool<Map, true, 16>` defaults to
    // `UnwiredStorage` which panics on first `get_node()`.
    bun_collections::object_pool!(pub Pool: Map, threadsafe, 16);
    pub(crate) type PoolNode = bun_collections::pool::Node<Map>;
}

pub(crate) struct Formatter<'a> {
    pub(crate) remaining_values: &'a [JSValue],
    pub(crate) map: visited::Map,
    /// Lazily acquired from `visited::Pool`; released back in `Drop`.
    pub(crate) map_node: Option<core::ptr::NonNull<visited::PoolNode>>,
    pub global_this: &'a JSGlobalObject,
    pub(crate) indent: u32,
    pub(crate) quote_strings: bool,
    pub(crate) failed: bool,
    pub(crate) estimated_line_length: usize,
    pub(crate) always_newline_scope: bool,
    /// Of the snapshot file that is printed for. Not `Bun`: as pretty-format prints.
    pub(crate) snapshot_format: SnapshotFormat,
    /// See `did_older_bun_print`. True once there is no point in printing on.
    like_older_bun: Option<&'a core::cell::Cell<bool>>,
    /// False once something was printed that `like_older_bun` may print otherwise.
    same_as_older_bun: bool,
    /// The objects that the value being printed is in. pretty-format's `refs`.
    ancestors: ObjectList,
    /// See `count_copied`.
    copied: usize,
    /// pretty-format's `printBasicPrototype`: `Object {}` and `Array []`.
    print_basic_prototype: bool,
    /// The plugins of `expect.addSnapshotSerializer()`.
    serializers: Option<JSValue>,
    /// What they are given as pretty-format's `config`, once one has been called.
    config: Option<JSValue>,
}

impl<'a> Formatter<'a> {
    pub(crate) fn new(global: &'a JSGlobalObject) -> Self {
        Self {
            remaining_values: &[],
            map: visited::Map::default(),
            map_node: None,
            global_this: global,
            indent: 0,
            quote_strings: false,
            failed: false,
            estimated_line_length: 0,
            always_newline_scope: false,
            snapshot_format: SnapshotFormat::Bun,
            like_older_bun: None,
            same_as_older_bun: true,
            ancestors: ObjectList::default(),
            copied: 0,
            print_basic_prototype: false,
            serializers: None,
            config: None,
        }
    }

    pub(crate) fn good_time_for_a_new_line(&mut self) -> bool {
        if self.estimated_line_length > 80 {
            self.reset_line();
            return true;
        }
        false
    }

    pub(crate) fn reset_line(&mut self) {
        self.estimated_line_length = (self.indent as usize) * 2;
    }

    pub(crate) fn add_for_new_line(&mut self, len: usize) {
        self.estimated_line_length = self.estimated_line_length.saturating_add(len);
    }
}

// The node is acquired lazily inside `print_as` via `visited::Pool::get_node()`;
// releasing here covers every exit path of `format` (early `len == 1` return,
// `?` propagation from `Tag::get`/`fmt.format`, and the happy path) without
// the borrow-aliasing a `scopeguard` would introduce.
impl Drop for Formatter<'_> {
    fn drop(&mut self) {
        if let Some(mut node) = self.map_node.take() {
            // SAFETY: `node` came from `visited::Pool::get_node()` and is
            // exclusively owned for this `Formatter`'s lifetime; its `data` was
            // initialized by `Map::INIT`, so `assume_init_mut` observes a valid
            // `Map`.
            unsafe {
                let data = node.as_mut().data.assume_init_mut();
                *data = core::mem::take(&mut self.map);
                data.clear();
                visited::Pool::release(node.as_ptr());
            }
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub(crate) enum Tag {
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

    JSX,
    Event,
}

impl Tag {
    pub(crate) fn is_primitive(self) -> bool {
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
    pub(crate) const fn can_have_circular_references(self) -> bool {
        matches!(self, Tag::Array | Tag::Object | Tag::Map | Tag::Set)
    }
}

#[derive(Copy, Clone)]
pub(crate) struct TagResult {
    pub(crate) tag: Tag,
    pub cell: JSType,
}

impl Default for TagResult {
    fn default() -> Self {
        Self { tag: Tag::Undefined, cell: JSType::Cell }
    }
}

impl Tag {
    pub(crate) fn get(value: JSValue, global_this: &JSGlobalObject) -> JsResult<TagResult> {
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
            return Tag::get(value.get_proxy_target(), global_this);
        }

        // Is this a react element?
        if js_type.is_object() && js_type != JSType::ProxyObject {
            if let Some(typeof_symbol) = value.get_own_truthy(global_this, "$$typeof")? {
                if typeof_symbol
                    .is_same_value(JSValue::symbol_for(global_this, b"react.element"), global_this)?
                    || typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, b"react.fragment"),
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

impl<'a> Formatter<'a> {
    fn write_with_formatting<W: bun_io::Write, S, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer_: &mut W,
        slice_: S,
        global_this: &'a JSGlobalObject,
    ) where
        // The sole caller here passes a UTF-8 byte slice, so only the byte
        // path is needed.
        S: AsRef<[u8]>,
    {
        let mut writer = WrappedWriter::new(writer_);
        let mut slice = slice_.as_ref();
        let mut i: u32 = 0;
        let mut len: u32 = slice.len() as u32;
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
                    writer.write_all(end);
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
                _ => {}
            }
            i += 1;
        }

        if !slice.is_empty() {
            writer.write_all(slice);
        }
    }
}

pub(crate) struct WrappedWriter<'w, W: bun_io::Write> {
    pub ctx: &'w mut W,
    pub(crate) failed: bool,
}

impl<'w, W: bun_io::Write> WrappedWriter<'w, W> {
    pub(crate) fn new(ctx: &'w mut W) -> Self {
        Self { ctx, failed: false }
    }

    pub(crate) fn print(&mut self, args: core::fmt::Arguments<'_>) {
        if self.ctx.write_fmt(args).is_err() {
            self.failed = true;
        }
    }

    #[inline]
    pub(crate) fn write_all(&mut self, buf: &[u8]) {
        if self.write_all_raw(buf).is_err() {
            self.failed = true;
        }
    }

    #[inline]
    fn write_all_raw(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.ctx.write_all(buf)
    }

    #[inline]
    pub(crate) fn write_string(&mut self, str: &bun_core::String) {
        self.print(format_args!("{}", str));
    }

    #[inline]
    pub(crate) fn write_16_bit(&mut self, input: &[u16]) {
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
    pub(crate) fn write_indent<W: bun_io::Write>(&self, writer: &mut W) -> bun_io::Result<()> {
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

    pub(crate) fn print_comma<W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> bun_io::Result<()> {
        writer.write_all(pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><d>,<r>").as_bytes())?;
        self.estimated_line_length += 1;
        Ok(())
    }
}

// split lifetimes — `&'a mut Formatter<'a>` is invariant and forces
// the borrow of `self` at the call site to outlive `'a`, cascading into bogus
// borrowck errors throughout `print_as`. Using a distinct `'f` for the
// Formatter's own lifetime keeps the iter borrow local.
pub(crate) struct MapIterator<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub(crate) formatter: &'a mut Formatter<'f>,
    pub(crate) writer: &'a mut W,
}

impl<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    MapIterator<'a, 'f, W, ENABLE_ANSI_COLORS>
{
    pub(crate) extern "C" fn for_each(
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

pub(crate) struct SetIterator<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub(crate) formatter: &'a mut Formatter<'f>,
    pub(crate) writer: &'a mut W,
}

impl<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    SetIterator<'a, 'f, W, ENABLE_ANSI_COLORS>
{
    pub(crate) extern "C" fn for_each(
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

pub(crate) struct PropertyIterator<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool> {
    pub(crate) formatter: &'a mut Formatter<'f>,
    pub(crate) writer: &'a mut W,
    pub(crate) i: usize,
    pub(crate) always_newline: bool,
    pub(crate) parent: JSValue,
}

impl<'a, 'f, W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>
    PropertyIterator<'a, 'f, W, ENABLE_ANSI_COLORS>
{
    pub(crate) fn handle_first_property(
        &mut self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        if !value.js_type().is_function() {
            let mut writer = WrappedWriter::new(self.writer);
            let name_str = value.get_name_property(global_this)?;
            if !name_str.is_empty() && !name_str.eq_ascii(b"Object") {
                writer.print(format_args!("{} ", name_str));
            } else {
                let name_str = value
                    .get_prototype(global_this)?
                    .get_name_property(global_this)?;
                if !name_str.is_empty() && !name_str.eq_ascii(b"Object") {
                    writer.print(format_args!("{} ", name_str));
                }
            }
        }

        self.always_newline = true;
        self.formatter.estimated_line_length = (self.formatter.indent as usize) * 2 + 1;

        if self.formatter.indent == 0 {
            let _ = self.writer.write_all(b"\n");
        }
        let classname = value.get_class_name(global_this)?;
        if !classname.is_empty() && !classname.eq_ascii(b"Object") {
            let _ = self.writer.write_fmt(format_args!("{} ", classname));
        }

        let _ = self.writer.write_all(b"{\n");
        self.formatter.indent += 1;
        let _ = self.formatter.write_indent(self.writer);
        Ok(())
    }

    extern "C" fn for_each(
        global_this: &JSGlobalObject,
        ctx_ptr: *mut c_void,
        key_: *mut EncodedSlice,
        value: JSValue,
        is_symbol: bool,
        is_private_symbol: bool,
    ) {
        if is_private_symbol {
            return;
        }

        // SAFETY: key_ is non-null per JSC contract for property iteration.
        let key = unsafe { *key_ };
        if key.eq_ascii(b"constructor") {
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
        // reshaped for borrowck — `handle_first_property` needs `&mut *ctx`,
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

        // ctx.i is incremented at end of fn.
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
            if (!key.is_16bit() && bun_ast::lexer_tables::is_latin1_identifier(key.slice()))
                || (key.is_16bit()
                    && bun_ast::lexer_tables::is_latin1_identifier_u16(key.utf16_slice()))
            {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    concat!("{}", "\"{}\"", "{}", ":", "{}", " "),
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                    key,
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                ));
            } else if key.is_16bit() {
                let utf16_slice = key.utf16_slice();

                this.add_for_new_line(utf16_slice.len() + 2);

                if ENABLE_ANSI_COLORS {
                    writer.write_all(pretty_fmt_const!(true, "<r><green>").as_bytes());
                }

                writer.write_all(b"\"");
                writer.write_16_bit(utf16_slice);
                writer.print(format_args!(
                    "\"{}:{} ",
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><d>"),
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                ));
            } else {
                this.add_for_new_line(key.len + 2);

                writer.print(format_args!(
                    "{}{}{}:{} ",
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><green>"),
                    bun_fmt::format_json_string_latin1(key.slice()),
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><d>"),
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                ));
            }
        } else {
            this.add_for_new_line(1 + b"[Symbol()]:".len() + key.len);
            writer.print(format_args!(
                "{}[{}Symbol({}){}]:{} ",
                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><d>"),
                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                key,
                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><d>"),
                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
            ));
        }

        if tag.cell.is_string_like() {
            if ENABLE_ANSI_COLORS {
                writer.write_all(pretty_fmt_const!(true, "<r><green>").as_bytes());
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
                writer.write_all(pretty_fmt_const!(true, "<r>").as_bytes());
            }
        }

        ctx.i += 1;
    }
}

impl<'a> Formatter<'a> {
    pub(crate) fn print_as<W: bun_io::Write, const FORMAT: Tag, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer_: &mut W,
        value: JSValue,
        js_type: JSType,
    ) -> JsResult<()> {
        if self.failed {
            return Ok(());
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            self.failed = true;
            return Err(self.global_this.throw_stack_overflow());
        }
        // reshaped for borrowck — `WrappedWriter` borrows both writer_
        // and &mut self.estimated_line_length; we use a local wrapper and sync
        // `failed` at scope exit. estimated_line_length is unused by WrappedWriter
        // methods in this file, so we leave it None here.
        let mut writer = WrappedWriter::new(writer_);

        if FORMAT.can_have_circular_references() {
            if self.map_node.is_none() {
                // `visited::Pool::get()` returns an RAII `PoolGuard` that
                // would release on scope exit; instead the raw node is stashed on
                // `self` and released from `JestPrettyFormat::format`'s tail, so
                // take the raw node directly. `data` is initialized by
                // `Map::INIT` (see `visited::Map: ObjectPoolType`).
                let node = core::ptr::NonNull::new(visited::Pool::get_node())
                    .expect("ObjectPool::get_node never returns null");
                self.map_node = Some(node);
                // Take the map here and swap it back into
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
                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><cyan>[Circular]<r>").as_bytes(),
                );
                if writer.failed {
                    self.failed = true;
                }
                // Return BEFORE the remove() cleanup below is reached,
                // so the parent frame's entry stays in the map.
                return Ok(());
            }
        }

        // Wrap the match in a closure and unconditionally
        // call `self.map.remove(&value)` after it returns (Ok or Err). A scopeguard
        // cannot be used here because it would hold `&mut self` across the match body.
        let result: JsResult<()> = (|| {
            match FORMAT {
                Tag::StringPossiblyFormatted => {
                    let str = value.to_utf8(self.global_this)?;
                    let slice = str.slice();
                    self.add_for_new_line(slice.len());
                    self.write_with_formatting::<W, _, ENABLE_ANSI_COLORS>(
                        writer.ctx,
                        slice,
                        self.global_this,
                    );
                }
                Tag::String => {
                    let view = value.to_js_string_view(self.global_this)?;
                    let str = view.to_encoded_slice();
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
                            writer.write_all(pretty_fmt_const!(true, "<r><green>").as_bytes());
                        }

                        let mut has_newline = false;

                        if str.index_of_any(b"\n\r").is_some() {
                            has_newline = true;
                            writer.write_all(b"\n");
                        }

                        writer.write_all(b"\"");
                        let mut remaining = str;
                        // `EncodedSlice::char_at` returns u16; use explicit u16
                        // consts so the match arms type-check.
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

                        writer.print(format_args!("{}", remaining));
                        writer.write_all(b"\"");

                        if has_newline {
                            writer.write_all(b"\n");
                        }
                        // The `<r>` reset must come AFTER the trailing `\n`
                        // to keep byte-for-byte parity with colored output.
                        if ENABLE_ANSI_COLORS {
                            writer.write_all(pretty_fmt_const!(true, "<r>").as_bytes());
                        }
                        return Ok(());
                    }

                    if js_type == JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!(
                            "{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><red>")
                        ));
                    }

                    if str.is_16bit() {
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
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>")
                        ));
                    }
                }
                Tag::Integer => {
                    let int = value.to_int64();
                    self.add_for_new_line(bun_fmt::digit_count(int));
                    writer.print(format_args!(
                        "{}{}{}",
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>"),
                        int,
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                    ));
                }
                Tag::BigInt => {
                    let view = value.to_js_string_view(self.global_this)?;
                    let out_str = view.latin1();
                    self.add_for_new_line(out_str.len());

                    writer.print(format_args!(
                        "{}{}n{}",
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>"),
                        bstr::BStr::new(out_str),
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    } else if num.is_infinite() && num.is_sign_negative() {
                        self.add_for_new_line(b"-Infinity".len());
                        writer.print(format_args!(
                            "{}-Infinity{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    } else if num.is_nan() {
                        self.add_for_new_line(b"NaN".len());
                        writer.print(format_args!(
                            "{}NaN{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    } else {
                        // WTF::dtoa drops the sign bit on -0; preserve it.
                        let mut dtoa_buf = [0u8; 124];
                        let dtoa =
                            bun_fmt::FormatDouble::dtoa_with_negative_zero(&mut dtoa_buf, num);
                        self.add_for_new_line(dtoa.len());
                        writer.write_all(
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>").as_bytes(),
                        );
                        writer.write_all(dtoa);
                        writer.write_all(
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>").as_bytes(),
                        );
                    }
                }
                Tag::Undefined => {
                    self.add_for_new_line(9);
                    writer.print(format_args!(
                        "{}undefined{}",
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><d>"),
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                    ));
                }
                Tag::Null => {
                    self.add_for_new_line(4);
                    writer.print(format_args!(
                        "{}null{}",
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>"),
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                    ));
                }
                Tag::Symbol => {
                    let description = value.get_description(self.global_this);
                    self.add_for_new_line(b"Symbol".len());

                    if !description.is_empty() {
                        self.add_for_new_line(description.length() + b"()".len());
                        writer.print(format_args!(
                            "{}Symbol({}){}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                            description,
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}Symbol{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    }
                }
                Tag::Error => {
                    let classname = value.get_class_name(self.global_this)?;
                    let mut message_string = bun_core::String::EMPTY;

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
                    let printable = value.get_class_name(self.global_this)?;
                    self.add_for_new_line(printable.length());

                    if printable.is_empty() {
                        writer.print(format_args!(
                            "{}[class]{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[class {}]{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>"),
                            printable,
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    }
                }
                Tag::Function => {
                    let printable = value.get_name_property(self.global_this)?;

                    if printable.is_empty() {
                        writer.print(format_args!(
                            "{}[Function]{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[Function: {}]{}",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>"),
                            printable,
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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

                        let prev_quote_strings = self.quote_strings;
                        self.quote_strings = true;

                        // `indent` and `quote_strings` must be
                        // restored even when `Tag::get` / `format` throw. Wrap the fallible body in
                        // a closure and restore unconditionally afterward.
                        let inner: JsResult<()> = (|| {
                            {
                                let element = value.get_index(self.global_this, 0)?;
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
                                            pretty_fmt_const!(true, "<r>").as_bytes(),
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

                                let element = value.get_index(self.global_this, i)?;
                                let tag = Tag::get(element, self.global_this)?;

                                self.format::<W, ENABLE_ANSI_COLORS>(
                                    tag, writer.ctx, element, self.global_this,
                                )?;

                                if tag.cell.is_string_like() {
                                    if ENABLE_ANSI_COLORS {
                                        writer.write_all(
                                            pretty_fmt_const!(true, "<r>").as_bytes(),
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
                    // Per-type `write_format` dispatch for Bun-native cells.
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
                                    bun_core::Error::FmtError,
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
                                    bun_core::Error::FmtError,
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
                            .write_format::<_, _, ENABLE_ANSI_COLORS>(value, self, &mut bridge)
                            .is_err()
                        {
                            self.failed = true;
                            // TODO: make this better
                            if !self.global_this.has_exception() {
                                return Err(self.global_this.throw_error(
                                    bun_core::Error::FmtError,
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
                                    bun_core::Error::FmtError,
                                    "failed to print Blob",
                                ));
                            }
                            return Err(JsError::Thrown);
                        }
                        return Ok(());
                    } else if bun_jsc::DOMFormData::from_js(value).is_some() {
                        if let Some(to_json_function) = value
                            .get(self.global_this, "toJSON")?
                            .filter(|f| f.is_callable())
                        {
                            self.add_for_new_line(b"FormData (entries) ".len());
                            writer.write_all(
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>FormData<r> <d>(entries)<r> ")
                                .as_bytes(),
                            );

                            return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                                writer.ctx,
                                to_json_function.call(self.global_this, value, &[])?,
                                JSType::Object,
                            );
                        }

                        return self.print_as::<W, { Tag::Object }, ENABLE_ANSI_COLORS>(
                            writer.ctx, value, JSType::Event,
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
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<yellow>"),
                                timer.internals.id,
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                            ));
                        } else {
                            writer.print(format_args!(
                                "{}Timeout{} {}(#{}{}{}{}){}",
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<yellow>"),
                                timer.internals.id,
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<yellow>"),
                            immediate.internals.id,
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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
                    } else if JestPrettyFormat::print_asymmetric_matcher::<_, W, ENABLE_ANSI_COLORS>(
                        self, &mut writer, value,
                    )? {
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
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>true<r>").as_bytes(),
                        );
                    } else {
                        self.add_for_new_line(5);
                        writer.write_all(
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><yellow>false<r>").as_bytes(),
                        );
                    }
                }
                Tag::GlobalObject => {
                    const FMT: &str = "[this.globalThis]";
                    self.add_for_new_line(FMT.len());
                    writer.write_all(
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>[this.globalThis]<r>")
                        .as_bytes(),
                    );
                }
                Tag::Map => {
                    let length_value = value
                        .get(self.global_this, "size")?
                        .unwrap_or_else(|| JSValue::js_number_from_int32(0));
                    let length = if length_value.is_number() {
                        length_value.coerce_to_i32(self.global_this)?
                    } else {
                        0
                    };

                    let prev_quote_strings = self.quote_strings;
                    self.quote_strings = true;

                    let map_name: &str =
                        if value.js_type() == JSType::WeakMap { "WeakMap" } else { "Map" };

                    if length == 0 {
                        self.quote_strings = prev_quote_strings;
                        writer.print(format_args!("{} {{}}", map_name));
                        return Ok(());
                    }

                    writer.print(format_args!("\n{} {{\n", map_name));
                    {
                        self.indent += 1;
                        // hoist global_this (Copy &ref) before iter mutably
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
                        // `indent` / `quote_strings` must be restored on every exit,
                        // including thrown exceptions — restore before propagating.
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
                    let length = if length_value.is_number() {
                        length_value.coerce_to_i32(self.global_this)?
                    } else {
                        0
                    };

                    let prev_quote_strings = self.quote_strings;
                    self.quote_strings = true;

                    let _ = self.write_indent(writer.ctx);

                    let set_name: &str =
                        if value.js_type() == JSType::WeakSet { "WeakSet" } else { "Set" };

                    if length == 0 {
                        self.quote_strings = prev_quote_strings;
                        writer.print(format_args!("{} {{}}", set_name));
                        return Ok(());
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
                        // `indent` / `quote_strings` must be restored on every exit,
                        // including thrown exceptions — restore before propagating.
                        self.indent = self.indent.saturating_sub(1);
                        self.quote_strings = prev_quote_strings;
                        result?;
                    }
                    let _ = self.write_indent(writer.ctx);
                    writer.write_all(b"}");
                    writer.write_all(b"\n");
                }
                Tag::JSON => {
                    let str = value.json_stringify(self.global_this, self.indent)?;
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
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><magenta>"),
                            bstr::BStr::new(out_buf),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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

                    let event_type = match EVENT_TYPE_MAP
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
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><cyan>"),
                        <&'static str>::from(event_type),
                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                    ));
                    {
                        self.indent += 1;
                        let old_quote_strings = self.quote_strings;
                        self.quote_strings = true;
                        // `indent` and `quote_strings` must be
                        // restored even when `fast_get` / `Tag::get` / `format` throw.
                        // Wrap the fallible body and restore unconditionally afterward.
                        let inner: JsResult<()> = (|| {
                        self.write_indent(writer.ctx).expect("unreachable");

                        writer.print(format_args!(
                            "{}type: {}\"{}\"{}{},{}\n",
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<green>"),
                            bstr::BStr::new(event_type.label()),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                        ));

                        if let Some(message_value) =
                            value.fast_get(self.global_this, jsc::BuiltinName::Message)?
                        {
                            if message_value.is_string() {
                                self.write_indent(writer.ctx).expect("unreachable");
                                writer.print(format_args!(
                                    "{}message{}:{} ",
                                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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
                                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                    pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                                ));
                                let data: JSValue = value
                                    .fast_get(self.global_this, jsc::BuiltinName::Data)?
                                    .unwrap_or(JSValue::UNDEFINED);
                                let tag = Tag::get(data, self.global_this)?;

                                self.format::<W, ENABLE_ANSI_COLORS>(
                                    tag, writer.ctx, data, self.global_this,
                                )?;
                                writer.write_all(b", \n");
                            }
                            EventType::ErrorEvent => {
                                if let Some(data) =
                                    value.fast_get(self.global_this, jsc::BuiltinName::Error)?
                                {
                                    self.write_indent(writer.ctx).expect("unreachable");
                                    writer.print(format_args!(
                                        "{}error{}:{} ",
                                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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
                    writer.write_all(pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>").as_bytes());

                    writer.write_all(b"<");

                    let mut needs_space;

                    let tag_name_view;
                    let tag_name_slice: Utf8Bytes;
                    let mut is_tag_kind_primitive = false;

                    if let Some(type_value) = value.get(self.global_this, "type")? {
                        let _tag = Tag::get(type_value, self.global_this)?;

                        if _tag.cell == JSType::Symbol {
                            tag_name_slice = Utf8Bytes::EMPTY;
                        } else if _tag.cell.is_string_like() {
                            tag_name_view = type_value.to_js_string_view(self.global_this)?;
                            tag_name_slice = tag_name_view.to_utf8();
                            is_tag_kind_primitive = true;
                        } else if _tag.cell.is_object() || type_value.is_callable() {
                            let name = type_value.get_name_property(self.global_this)?;
                            tag_name_slice = if name.is_empty() {
                                Utf8Bytes::Borrowed(b"NoName")
                            } else {
                                name.into_utf8()
                            };
                        } else {
                            tag_name_view = type_value.to_js_string_view(self.global_this)?;
                            tag_name_slice = tag_name_view.to_utf8();
                        }

                        needs_space = true;
                    } else {
                        tag_name_slice = Utf8Bytes::Borrowed(b"unknown");

                        needs_space = true;
                    }

                    if !is_tag_kind_primitive {
                        writer.write_all(
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>").as_bytes(),
                        );
                    } else {
                        writer.write_all(
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<green>").as_bytes(),
                        );
                    }
                    writer.write_all(tag_name_slice.slice());
                    if ENABLE_ANSI_COLORS {
                        writer.write_all(
                            pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>").as_bytes(),
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

                        // `quote_strings` (and nested `indent` scopes) must be restored on
                        // every exit, including thrown exceptions. Wrap the fallible body in a
                        // closure (Ok(true) ⇒ children path printed the closing tag, so the
                        // trailing " />" is skipped) and restore unconditionally afterward.
                        let inner: JsResult<bool> = (|| {
                        let Some(props_obj) = props.get_object() else { return Ok(false); };
                        let props_iter = JSPropertyIterator::init(
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
                                // `JSPropertyIterator::i` is private upstream;
                                // track the 1-based iteration index locally.
                                let mut iter_i: usize = 0;
                                while let Some((prop, property_value)) = props_iter.next()? {
                                    iter_i += 1;
                                    if prop.eq_ascii(b"children") {
                                        continue;
                                    }

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
                                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><blue>"),
                                        prop.trunc(128),
                                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<d>"),
                                        pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
                                    ));

                                    if tag.cell.is_string_like() {
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                pretty_fmt_const!(true, "<r><green>").as_bytes(),
                                            );
                                        }
                                    }

                                    self.format::<W, ENABLE_ANSI_COLORS>(
                                        tag, writer.ctx, property_value, self.global_this,
                                    )?;

                                    if tag.cell.is_string_like() {
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                pretty_fmt_const!(true, "<r>").as_bytes(),
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
                                                    children.to_js_string_view(self.global_this)?;
                                                if children_string.is_empty() {
                                                    break 'print_children;
                                                }
                                                if ENABLE_ANSI_COLORS {
                                                    writer.write_all(
                                                        pretty_fmt_const!(true, "<r>").as_bytes(),
                                                    );
                                                }

                                                writer.write_all(b">");
                                                if children_string.length() < 128 {
                                                    writer.write_string(&children_string);
                                                } else {
                                                    self.indent += 1;
                                                    writer.write_all(b"\n");
                                                    self.write_indent(writer.ctx)
                                                        .expect("unreachable");
                                                    self.indent = self.indent.saturating_sub(1);
                                                    writer.write_string(&children_string);
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
                                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><cyan>")
                                                .as_bytes(),
                                            );
                                        } else {
                                            writer.write_all(
                                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r><green>")
                                                .as_bytes(),
                                            );
                                        }
                                        writer.write_all(tag_name_slice.slice());
                                        if ENABLE_ANSI_COLORS {
                                            writer.write_all(
                                                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>")
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

                    let each = PropertyIterator::<W, ENABLE_ANSI_COLORS>::for_each;
                    let result = if iter.formatter.like_older_bun.is_some() {
                        value
                            .for_each_property_ordered_with_non_enumerable(global, (&raw mut iter).cast::<c_void>(), each)
                            .map(|()| true)
                    } else {
                        value.for_each_property_ordered_calling_getters(global, (&raw mut iter).cast::<c_void>(), each)
                    };

                    let iter_i = iter.i;
                    let iter_always_newline = iter.always_newline;
                    // `always_newline_scope` / `quote_strings` must be restored on every
                    // exit — restore before propagating any exception from the property iterator.
                    self.always_newline_scope = prev_always_newline_scope;
                    self.quote_strings = prev_quote_strings;
                    self.same_as_older_bun &= result?;

                    if iter_i == 0 {
                        let object_name = value.get_class_name(self.global_this)?;

                        if !object_name.eq_ascii(b"Object") {
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
                        let buffer_name = value.get_class_name(self.global_this)?;
                        if buffer_name.eq_ascii(b"Buffer") {
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
                            // SAFETY: `Unaligned<$t>` has align 1 and the same size as `$t`, so any
                            // `*const u8` is a valid `*const Unaligned<$t>`; `slice` is the live
                            // backing store of a JSC typed array whose elements are valid `$t`.
                            let slice_with_type: &[bun_core::Unaligned<$t>] = unsafe {
                                core::slice::from_raw_parts(
                                    slice.as_ptr().cast::<bun_core::Unaligned<$t>>(),
                                    slice.len() / core::mem::size_of::<$t>(),
                                )
                            };
                            self.indent += 1;
                            for el in slice_with_type {
                                writer.write_all(b"\n");
                                let _ = self.write_indent(writer.ctx);
                                writer.print(format_args!("{},", el.get()));
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

    pub(crate) fn format<W: bun_io::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        result: TagResult,
        writer: &mut W,
        value: JSValue,
        global_this: &'a JSGlobalObject,
    ) -> JsResult<()> {
        if self.snapshot_format.is_pretty_format() || self.serializers.is_some() {
            let mut printed = Vec::new();
            let is_printed = self.print_for_other_runners(&mut printed, value);
            let _ = writer.write_all(&printed);
            if is_printed? {
                return Ok(());
            }
        }

        let prev_global_this = self.global_this;
        // `self.global_this` is restored to the previous value at the end.
        self.global_this = global_this;

        if let Some(differs) = self.like_older_bun {
            self.failed |= differs.get();
        } else if matches!(result.tag, Tag::Object | Tag::Array | Tag::JSON) {
            match super::dom_format::print_in_snapshot(self, writer, value) {
                Ok(false) => {}
                printed => {
                    self.global_this = prev_global_this;
                    self.same_as_older_bun = false;
                    return printed.map(drop);
                }
            }
        }

        // This looks incredibly redundant. Each tag variant dispatches to its
        // own small formatting function; that _should_ limit the stack usage
        // because each version of the function will be relatively small.
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
            Tag::TypedArray => self
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
        let mut sink = bun_io::FmtAdapter::new(writer);
        let global = self.global_this;
        self.format::<_, ENABLE_ANSI_COLORS>(
            TagResult { tag: tag.into(), cell },
            &mut sink,
            value,
            global,
        )
    }
}

impl From<bun_jsc::FormatTag> for Tag {
    fn from(tag: bun_jsc::FormatTag) -> Tag {
        use bun_jsc::FormatTag as Ft;
        // Map the wider `console_object::Tag` onto this file's `Tag`. Only the
        // variants the `write_format` hooks actually emit are reachable
        // (Boolean / Double / Object / Private / String); the rest collapse
        // onto `Object` so any future caller still renders something useful.
        match tag {
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
        }
    }
}

/// Duck-type surface that [`JestPrettyFormat::print_asymmetric_matcher`] needs
/// from a formatter. This trait is
/// implemented for both [`Formatter`] (this module) and
/// [`bun_jsc::console_object::Formatter`] so the same body serves the test
/// runner *and* `console.log`'s `.Private` arm (via the
/// `RuntimeHooks::console_print_runtime_object` hook).
pub(crate) trait AsymmetricMatcherFormatter {
    fn amf_add_for_new_line(&mut self, n: usize);
    fn amf_global_this(&self) -> &JSGlobalObject;
    fn amf_quote_strings(&mut self) -> &mut bool;
    /// `printAs(tag, …)` routed through the formatter's own runtime
    /// dispatcher. Only `Object` / `String` / `Array` are reached.
    fn amf_print_as<W: bun_io::Write, const C: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        w: &mut W,
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
    fn amf_print_as<W: bun_io::Write, const C: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        w: &mut W,
        v: JSValue,
        cell: JSType,
    ) -> JsResult<()> {
        // The writer itself: an adapter around it for each matcher inside a matcher makes every
        // write as deep as they are nested, where nothing checks the stack.
        let global = self.global_this;
        self.format::<W, C>(TagResult { tag: tag.into(), cell }, w, v, global)
    }
}

impl AsymmetricMatcherFormatter for bun_jsc::console_object::Formatter<'_> {
    #[inline]
    fn amf_add_for_new_line(&mut self, n: usize) { self.add_for_new_line(n); }
    #[inline]
    fn amf_global_this(&self) -> &JSGlobalObject { self.global_this }
    #[inline]
    fn amf_quote_strings(&mut self) -> &mut bool { &mut self.quote_strings }
    fn amf_print_as<W: bun_io::Write, const C: bool>(
        &mut self,
        tag: bun_jsc::FormatTag,
        w: &mut W,
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

    pub(crate) fn print_asymmetric_matcher<M, W, const ENABLE_ANSI_COLORS: bool>(
        // the Formatter instance
        this: &mut M,
        // The WrappedWriter (caller's instance — `failed` propagates back)
        writer: &mut WrappedWriter<'_, W>,
        value: JSValue,
    ) -> JsResult<bool>
    where
        M: AsymmetricMatcherFormatter,
        W: bun_io::Write,
    {
        // Passing both the `WrappedWriter` and the raw inner writer
        // would be two live `&mut W` to the same target
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

            let class_name = constructor_value.get_class_name(this.amf_global_this())?;
            this.amf_add_for_new_line(class_name.length());
            writer.print(format_args!(
                "{}{}{}",
                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<cyan>"),
                class_name,
                pretty_fmt_const!(ENABLE_ANSI_COLORS, "<r>"),
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
            this.amf_print_as::<W, ENABLE_ANSI_COLORS>(
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
            this.amf_print_as::<W, ENABLE_ANSI_COLORS>(
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
            this.amf_print_as::<W, ENABLE_ANSI_COLORS>(
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
                this.amf_print_as::<W, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatTag::Array, &mut *writer.ctx, args_value, JSType::Array,
                )?;
            }
        } else {
            return Ok(false);
        }
        Ok(true)
    }
}

/// What pretty-format tells apart with `Object.prototype.toString.call(value)` and `value instanceof Error`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Object,
    Arguments,
    /// Arrays, `ArrayBuffer`, `DataView`, and the typed arrays pretty-format knows.
    List,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Date,
    Error,
    RegExp,
    /// What only says that it is one.
    Function,
    Symbol,
    Promise,
}

impl Kind {
    fn of(global: &JSGlobalObject, object: JSValue) -> JsResult<Kind> {
        unsafe extern "C" {
            safe fn SnapshotFormat__kindOf(global: &JSGlobalObject, object: JSValue) -> u8;
        }
        const KINDS: [Kind; 13] = [
            Kind::Object,
            Kind::Arguments,
            Kind::List,
            Kind::Map,
            Kind::Set,
            Kind::WeakMap,
            Kind::WeakSet,
            Kind::Date,
            Kind::Error,
            Kind::RegExp,
            Kind::Function,
            Kind::Symbol,
            Kind::Promise,
        ];
        let kind = jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__kindOf(global, object))?;
        Ok(KINDS[usize::from(kind)])
    }
}

/// `Object.keys(object).sort()`, then the enumerable own symbols, each with `object[key]`.
fn for_each_sorted_property(
    global: &JSGlobalObject,
    object: JSValue,
    format: SnapshotFormat,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<()> {
    type Each<'a> = &'a mut dyn FnMut(JSValue, JSValue) -> JsResult<()>;
    unsafe extern "C" {
        safe fn SnapshotFormat__forEachProperty(
            global: &JSGlobalObject,
            object: JSValue,
            is_for_vitest: bool,
            each: *mut c_void,
            call: extern "C" fn(*mut c_void, JSValue, JSValue) -> bool,
        );
    }
    extern "C" fn call(each: *mut c_void, key: JSValue, value: JSValue) -> bool {
        // SAFETY: `each` is the `Each` below, which outlives the walk.
        (unsafe { &mut *each.cast::<Each<'_>>() })(key, value).is_ok()
    }
    let mut each: Each<'_> = each;
    jsc::host_fn::from_js_host_call_generic(global, || {
        let is_for_vitest = format == SnapshotFormat::Vitest;
        SnapshotFormat__forEachProperty(global, object, is_for_vitest, (&raw mut each).cast::<c_void>(), call)
    })
}

/// `index in value`
fn has_index(global: &JSGlobalObject, value: JSValue, index: u32) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__hasIndex(global: &JSGlobalObject, value: JSValue, index: u32) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__hasIndex(global, value, index))
}

/// How many times `for (let i = 0; i < value.length; i++)` goes round.
fn length_of(global: &JSGlobalObject, value: JSValue) -> JsResult<u32> {
    unsafe extern "C" {
        safe fn SnapshotFormat__lengthOf(global: &JSGlobalObject, value: JSValue) -> u32;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__lengthOf(global, value))
}

/// `value > 0`
fn is_greater_than_zero(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__isGreaterThanZero(global: &JSGlobalObject, value: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__isGreaterThanZero(global, value))
}

/// `Array.isArray(value)`
fn is_array(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__isArray(global: &JSGlobalObject, value: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__isArray(global, value))
}

/// `value[name]`, of any value.
fn member(global: &JSGlobalObject, value: JSValue, name: &'static str) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn SnapshotFormat__get(global: &JSGlobalObject, value: JSValue, name: *const u8, length: usize) -> JSValue;
    }
    // SAFETY: `name` is ASCII that outlives the call.
    jsc::host_fn::from_js_host_call(global, || unsafe { SnapshotFormat__get(global, value, name.as_ptr(), name.len()) })
}

/// `value[index]`, of any value.
fn item(global: &JSGlobalObject, value: JSValue, index: u32) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn SnapshotFormat__getIndex(global: &JSGlobalObject, value: JSValue, index: u32) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || SnapshotFormat__getIndex(global, value, index))
}

/// `value[key]`, of any value.
fn member_by_value(global: &JSGlobalObject, value: JSValue, key: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn SnapshotFormat__getByValue(global: &JSGlobalObject, value: JSValue, key: JSValue) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || SnapshotFormat__getByValue(global, value, key))
}

/// `key in value`
fn has_member(global: &JSGlobalObject, value: JSValue, key: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__hasByValue(global: &JSGlobalObject, value: JSValue, key: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__hasByValue(global, value, key))
}

/// Defines `object[key]`, for an object that the printer has made.
fn define(global: &JSGlobalObject, object: JSValue, key: JSValue, value: JSValue) -> JsResult<()> {
    unsafe extern "C" {
        safe fn SnapshotFormat__define(global: &JSGlobalObject, object: JSValue, key: JSValue, value: JSValue);
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__define(global, object, key, value))
}

/// What `expect.stringMatching()` makes of its argument in Jest and Vitest.
fn to_reg_exp(global: &JSGlobalObject, pattern: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn SnapshotFormat__toRegExp(global: &JSGlobalObject, pattern: JSValue) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || SnapshotFormat__toRegExp(global, pattern))
}

/// `value != null && typeof value === "object" && !Array.isArray(value)`
fn is_object_but_no_array(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    Ok(value.is_object() && !value.is_callable() && !is_array(global, value)?)
}

/// jest-snapshot `deepMerge`, Vitest `deepMergeSnapshot`: `target` with what `source`, the property matchers, has for
/// it, in plain copies of the objects and arrays that both have.
#[cold]
fn deep_merge(global: &JSGlobalObject, target: JSValue, source: JSValue, format: SnapshotFormat) -> JsResult<JSValue> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return Err(global.throw_stack_overflow());
    }
    if is_array(global, target)? && is_array(global, source)? {
        return deep_merge_array(global, target, source, format);
    }
    if !is_object_but_no_array(global, target)? || !is_object_but_no_array(global, source)? {
        return Ok(target);
    }
    let merged = JSValue::create_empty_object(global, 0);
    for_each_sorted_property(global, target, format, &mut |key, value| define(global, merged, key, value))?;
    for_each_member_of_source(global, source, format, &mut |key, from_source| {
        let is_matcher = || Ok::<bool, JsError>(expect::Expect::is_asymmetric_matcher(from_source) || member(global, from_source, "$$typeof")?.to_boolean());
        let value = if is_object_but_no_array(global, from_source)? && !is_matcher()? {
            if has_member(global, target, key)? {
                deep_merge(global, member_by_value(global, target, key)?, from_source, format)?
            } else {
                from_source
            }
        } else if is_array(global, from_source)? {
            deep_merge_array(global, member_by_value(global, target, key)?, from_source, format)?
        } else {
            from_source
        };
        define(global, merged, key, value)
    })?;
    Ok(merged)
}

/// `Object.keys(source)`, each with `source[key]`. A matcher of `expect` has the members that it has in Jest and Vitest.
fn for_each_member_of_source(
    global: &JSGlobalObject,
    source: JSValue,
    format: SnapshotFormat,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<()> {
    if let Some((sample, inverse, precision)) = members_of_matcher(global, source)? {
        let key = |name: &'static str| bun_core::String::static_(name).to_js(global);
        each(key("$$typeof")?, JSValue::symbol_for(global, b"jest.asymmetricMatcher"))?;
        each(key("inverse")?, JSValue::from(inverse))?;
        if let Some(precision) = precision {
            each(key("precision")?, precision)?;
        }
        return each(key("sample")?, sample);
    }
    for_each_sorted_property(global, source, format, &mut |key, value| if key.is_string() { each(key, value) } else { Ok(()) })
}

/// `sample`, `inverse` and, of `closeTo()`, `precision`.
fn members_of_matcher(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<(JSValue, bool, Option<JSValue>)>> {
    if value.js_type() != JSType::DOMWrapper {
        return Ok(None);
    }
    let found = |sample: Option<JSValue>, flags: expect::Flags| Some((sample.unwrap_or(JSValue::UNDEFINED), flags.not(), None));
    Ok(if let Some(matcher) = value.as_class_ref::<expect::ExpectArrayContaining>() {
        found(expect_js::array_containing::array_value_get_cached(value), matcher.flags.get())
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
        found(expect_js::object_containing::object_value_get_cached(value), matcher.flags.get())
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
        found(expect_js::string_containing::string_value_get_cached(value), matcher.flags.get())
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
        let sample = expect_js::string_matching::test_value_get_cached(value).map(|sample| to_reg_exp(global, sample)).transpose()?;
        found(sample, matcher.flags.get())
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
        found(expect_js::close_to::number_value_get_cached(value), matcher.flags.get())
            .map(|(sample, inverse, _)| (sample, inverse, expect_js::close_to::digits_value_get_cached(value)))
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
        found(expect_js::custom::captured_args_get_cached(value), matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectAny>() {
        found(expect_js::any::constructor_value_get_cached(value), matcher.flags.get())
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectAnything>() {
        found(None, matcher.flags.get())
    } else {
        None
    })
}

fn deep_merge_array(global: &JSGlobalObject, target: JSValue, source: JSValue, format: SnapshotFormat) -> JsResult<JSValue> {
    let is_vitest = format == SnapshotFormat::Vitest;
    let merged = JSValue::create_empty_array(global, 0)?;
    // Vitest: `target = []`, `source = []`
    let has_target = !(is_vitest && target.is_undefined());
    if has_target {
        for i in 0..length_of(global, target)? {
            merged.put_index(global, i, item(global, target, i)?)?;
        }
    }
    if is_vitest && source.is_undefined() {
        return Ok(merged);
    }
    if is_vitest && !is_array(global, source)? {
        return Err(global.throw_type_error(format_args!("source.forEach is not a function")));
    }
    for i in 0..length_of(global, source)? {
        // `forEach()` leaves out the holes, `entries()` does not.
        if is_vitest && !has_index(global, source, i)? {
            continue;
        }
        let from_source = item(global, source, i)?;
        let from_target = if has_target { item(global, target, i)? } else { JSValue::UNDEFINED };
        let value = if is_array(global, from_target)? && (is_vitest || is_array(global, from_source)?) {
            deep_merge_array(global, from_target, from_source, format)?
        } else if is_object_but_no_array(global, from_target)? && (is_vitest || !is_any_or_anything(from_source)) {
            deep_merge(global, from_target, from_source, format)?
        } else {
            from_source
        };
        merged.put_index(global, i, value)?;
    }
    Ok(merged)
}

fn is_any_or_anything(value: JSValue) -> bool {
    value.as_class_ref::<expect::ExpectAny>().is_some() || value.as_class_ref::<expect::ExpectAnything>().is_some()
}

/// `value === text`
fn is_text(global: &JSGlobalObject, value: JSValue, text: &[u8]) -> JsResult<bool> {
    Ok(value.is_string_literal() && value.to_bun_string(global)?.eq_ascii(text))
}

/// `function.call(this, ...arguments)`, where `function` is what `this[name]` was.
fn call(global: &JSGlobalObject, function: JSValue, this: JSValue, name: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
    if !function.is_callable() {
        return Err(global.throw_type_error(format_args!("{name} is not a function")));
    }
    function.call(global, this, arguments)
}

/// `object[name](...arguments)`
fn call_method(global: &JSGlobalObject, object: JSValue, name: &'static str, arguments: &[JSValue]) -> JsResult<JSValue> {
    call(global, member(global, object, name)?, object, name, arguments)
}

/// `object[a] || object[b] || ...`
fn first_truthy(global: &JSGlobalObject, object: JSValue, names: &[&'static str]) -> JsResult<Option<JSValue>> {
    for name in names {
        let value = member(global, object, name)?;
        if value.to_boolean() {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

/// The entries of a `Map` or the values of a `Set`. False, with nothing done, unless `method` is the `entries` or
/// `values` it is born with.
fn for_each_of_collection(
    global: &JSGlobalObject,
    collection: JSValue,
    method: JSValue,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<bool> {
    type Each<'a> = &'a mut dyn FnMut(JSValue, JSValue) -> JsResult<()>;
    unsafe extern "C" {
        safe fn SnapshotFormat__forEachOfCollection(
            global: &JSGlobalObject,
            collection: JSValue,
            method: JSValue,
            each: *mut c_void,
            call: extern "C" fn(*mut c_void, JSValue, JSValue) -> bool,
        ) -> bool;
    }
    extern "C" fn call(each: *mut c_void, first: JSValue, second: JSValue) -> bool {
        // SAFETY: `each` is the `Each` below, which outlives the walk.
        (unsafe { &mut *each.cast::<Each<'_>>() })(first, second).is_ok()
    }
    let mut each: Each<'_> = each;
    jsc::host_fn::from_js_host_call_generic(global, || {
        SnapshotFormat__forEachOfCollection(global, collection, method, (&raw mut each).cast::<c_void>(), call)
    })
}

fn write_string(global: &JSGlobalObject, out: &mut Vec<u8>, value: JSValue) -> JsResult<()> {
    out.extend_from_slice(value.to_js_string_view(global)?.to_utf8().slice());
    Ok(())
}

/// What a plugin returns is a string, or pretty-format's `TypeError`.
fn write_printed_by_plugin(global: &JSGlobalObject, out: &mut Vec<u8>, printed: JSValue) -> JsResult<()> {
    if !printed.is_string_literal() {
        return Err(global.throw_type_error(format_args!(
            "A snapshot serializer must return a string, received {}",
            printed.js_type_string(global),
        )));
    }
    write_string(global, out, printed)
}

/// Objects that are kept while script runs, in a JS array that only the printer has: the collector sees what is in it,
/// and sees it from the `Formatter`, which is on the stack.
#[derive(Copy, Clone, Default)]
struct ObjectList {
    array: Option<JSValue>,
    len: u32,
}

impl ObjectList {
    fn includes(self, value: JSValue) -> bool {
        unsafe extern "C" {
            safe fn SnapshotFormat__includes(list: JSValue, length: u32, value: JSValue) -> bool;
        }
        self.array.is_some_and(|array| SnapshotFormat__includes(array, self.len, value))
    }

    fn push(&mut self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let array = match self.array {
            Some(array) => array,
            None => *self.array.insert(JSValue::create_empty_array(global, 0)?),
        };
        array.put_index(global, self.len, value)?;
        self.len += 1;
        Ok(())
    }

    /// The array keeps the object until another takes its place.
    fn pop(&mut self) {
        self.len -= 1;
    }

    fn to_js_array(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let copy = JSValue::create_empty_array(global, 0)?;
        if let Some(array) = self.array {
            for i in 0..self.len {
                copy.put_index(global, i, array.get_index(global, i)?)?;
            }
        }
        Ok(copy)
    }
}

/// Compares what is written with `rest` instead of keeping it.
struct ExpectedText<'a> {
    rest: &'a [u8],
    differs: &'a core::cell::Cell<bool>,
}

impl bun_io::Write for ExpectedText<'_> {
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        match self.rest.strip_prefix(buf) {
            Some(rest) => self.rest = rest,
            None => self.differs.set(true),
        }
        Ok(())
    }
}

impl JestPrettyFormat {
    /// Whether `saved` is what Bun's format had for `value` when it printed a DOM node like any object, `[native code]`
    /// for an accessor, and the properties that are not enumerable. Stops printing where the two differ.
    #[cold]
    pub(crate) fn did_older_bun_print(global: &JSGlobalObject, value: JSValue, saved: &[u8]) -> JsResult<bool> {
        let differs = core::cell::Cell::new(false);
        let mut expected = ExpectedText { rest: saved, differs: &differs };
        let mut formatter = Formatter::new(global);
        formatter.quote_strings = true;
        formatter.like_older_bun = Some(&differs);
        let tag = Tag::get(value, global)?;
        let mut bridge = AsFmt::new(&mut expected);
        formatter.format::<_, false>(tag, &mut bun_io::write::FmtAdapter::new(&mut bridge), value, global)?;
        Ok(!differs.get() && expected.rest.is_empty())
    }

    /// What a snapshot of `value` holds in a file of `format`. True when `did_older_bun_print` has nothing else to compare.
    #[inline(never)]
    pub(crate) fn print_snapshot(
        global: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        out: &mut Vec<u8>,
        format: SnapshotFormat,
    ) -> JsResult<bool> {
        let mut formatter = Formatter::new(global);
        formatter.snapshot_format = format;
        formatter.serializers = Self::serializers(global)?;
        if !format.is_pretty_format() {
            formatter.quote_strings = true;
            let tag = Tag::get(value, global)?;
            let mut bridge = AsFmt::new(out);
            formatter.format::<_, false>(tag, &mut bun_io::write::FmtAdapter::new(&mut bridge), value, global)?;
            return Ok(formatter.same_as_older_bun && formatter.serializers.is_none());
        }

        let value = match property_matchers {
            Some(properties) => deep_merge(global, value, properties, format)?,
            None => value,
        };

        // jest-snapshot `addExtraLineBreaks(normalizeNewlines(format(value)))`
        let mut printed = Vec::new();
        formatter.print_like_pretty_format(&mut printed, value, false)?;
        let multiline = strings::index_of_any(&printed, b"\r\n").is_some();
        if multiline {
            out.push(b'\n');
        }
        let mut rest = printed.as_slice();
        while let Some(i) = strings::index_of_char_usize(rest, b'\r') {
            out.extend_from_slice(&rest[..i]);
            out.push(b'\n');
            rest = &rest[i + 1 + usize::from(rest.get(i + 1) == Some(&b'\n'))..];
        }
        out.extend_from_slice(rest);
        if multiline {
            out.push(b'\n');
        }
        Ok(false)
    }
}

/// Where Jest and Vitest run, the stack of pretty-format ends before 2,400 levels. What is printed on the way to the
/// end of Bun's grows with the square of the depth, for the indentation.
pub(crate) const MAX_INDENT: u32 = 4096;

/// pretty-format, with the options and the plugins of jest-snapshot.
impl Formatter<'_> {
    /// `spacingOuter + indentation`
    fn new_line(&self, out: &mut Vec<u8>) {
        out.push(b'\n');
        out.resize(out.len() + self.indent as usize * 2, b' ');
    }

    /// What is between the brackets of a collection: `print_items` gives each item a `new_line()` and ends it with a comma.
    fn print_indented(
        &mut self,
        out: &mut Vec<u8>,
        print_items: &mut dyn FnMut(&mut Self, &mut Vec<u8>) -> JsResult<()>,
    ) -> JsResult<()> {
        let empty = out.len();
        self.indent += 1;
        let result = print_items(self, out);
        self.indent -= 1;
        if out.len() != empty {
            self.new_line(out);
        }
        result
    }

    fn print_child(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<()> {
        self.print_like_pretty_format(out, value, false)
    }

    /// `bytes` more of what is printed were moved from one buffer to another, which is as limited as what is printed.
    pub(crate) fn count_copied(&mut self, bytes: usize) -> JsResult<()> {
        self.copied = self.copied.saturating_add(bytes);
        self.check_length(self.copied)
    }

    /// As long as a string can be where Jest and Vitest run, where pretty-format ends with a `RangeError` too.
    pub(crate) fn check_length(&self, length: usize) -> JsResult<()> {
        const MAX_LENGTH: usize = (1 << 29) - 24;
        if length > MAX_LENGTH {
            return Err(self.global_this.throw_value(
                self.global_this.create_range_error_instance(format_args!("The value is too large to print in a snapshot")),
            ));
        }
        Ok(())
    }

    /// False when `value` is left to Bun's own format, which only a serializer takes it from.
    #[cold]
    #[inline(never)]
    fn print_for_other_runners(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        if self.snapshot_format.is_pretty_format() {
            return self.print_like_pretty_format(out, value, false).map(|()| true);
        }
        if self.indent > 0 {
            return self.print_with_serializer(out, value);
        }
        out.push(b'\n');
        let is_printed = self.print_with_serializer(out, value)?;
        if strings::contains_char(&out[1..], b'\n') {
            out.push(b'\n');
        } else {
            out.remove(0);
        }
        Ok(is_printed)
    }

    /// `printer`
    #[inline(never)]
    pub(crate) fn print_like_pretty_format(
        &mut self,
        out: &mut Vec<u8>,
        value: JSValue,
        has_called_to_json: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        if self.indent > MAX_INDENT || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(global.throw_stack_overflow());
        }
        self.check_length(out.len())?;
        if self.serializers.is_some() && self.print_with_serializer(out, value)? {
            return Ok(());
        }

        if value.is_empty_or_undefined_or_null() {
            out.extend_from_slice(if value.is_null() { b"null" } else { b"undefined" });
        } else if value.is_boolean() {
            out.extend_from_slice(if value.to_boolean() { b"true" } else { b"false" });
        } else if value.is_number() {
            let number = value.as_number();
            if number.is_finite() {
                let mut buf = [0u8; 124];
                out.extend_from_slice(bun_fmt::FormatDouble::dtoa_with_negative_zero(&mut buf, number));
            } else {
                out.extend_from_slice(if number.is_nan() {
                    b"NaN"
                } else if number > 0.0 {
                    b"Infinity"
                } else {
                    b"-Infinity"
                });
            }
        } else if value.is_string_literal() {
            out.push(b'"');
            write_string(global, out, value)?;
            out.push(b'"');
        } else if value.is_big_int() {
            write_string(global, out, value)?;
            out.push(b'n');
        } else if value.is_symbol() {
            out.extend_from_slice(b"Symbol(");
            out.extend_from_slice(value.get_description(global).to_utf8().slice());
            out.push(b')');
        } else if !value.is_object() {
            out.extend_from_slice(b"[native code]");
        } else {
            return self.print_object_like_pretty_format(out, value, has_called_to_json);
        }
        Ok(())
    }

    /// The plugins of jest-snapshot, in their order. Script chooses every member they read: each is read, called and
    /// converted as pretty-format's JavaScript would, so what is not of the expected type ends as it does there.
    fn print_with_plugin(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        let global = self.global_this;
        let type_of = member(global, value, "$$typeof")?;
        let is = |name: &'static [u8]| type_of.is_symbol() && type_of == JSValue::symbol_for(global, name);
        if is(b"react.test.json") {
            return self.print_react_test_json(out, value).map(|()| true);
        }
        if !value.is_callable() && (is(b"react.element") || is(b"react.transitional.element")) {
            return self.print_react_element(out, value, is(b"react.element")).map(|()| true);
        }
        if super::dom_format::print_in_snapshot(self, out, value)? || self.print_immutable(out, value)? {
            return Ok(true);
        }
        if value.js_type() == JSType::DOMWrapper && self.print_asymmetric_matcher_like_pretty_format(out, value)? {
            return Ok(true);
        }
        if is(b"jest.asymmetricMatcher") {
            return self.print_foreign_asymmetric_matcher(out, value).map(|()| true);
        }
        if member(global, value, "_isMockFunction")?.to_boolean() {
            return self.print_mock_function(out, value).map(|()| true);
        }
        Ok(false)
    }

    fn print_object_like_pretty_format(
        &mut self,
        out: &mut Vec<u8>,
        value: JSValue,
        has_called_to_json: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        if self.print_with_plugin(out, value)? {
            return Ok(());
        }
        if value.is_callable() {
            out.extend_from_slice(b"[Function]");
            return Ok(());
        }

        let kind = Kind::of(global, value)?;
        match kind {
            Kind::WeakMap => out.extend_from_slice(b"WeakMap {}"),
            Kind::WeakSet => out.extend_from_slice(b"WeakSet {}"),
            Kind::Function => out.extend_from_slice(b"[Function]"),
            Kind::Promise if self.snapshot_format == SnapshotFormat::Jest => out.extend_from_slice(b"Promise {}"),
            Kind::Symbol => {
                // `String(value).replace(/^Symbol\((.*)\)(.*)$/, "Symbol($1)")`
                let text = value.to_bun_string(global)?;
                let text = text.to_utf8();
                let text = text.slice();
                let end = if text.starts_with(b"Symbol(") && !strings::contains_char(text, b'\n') {
                    strings::last_index_of_char(text, b')').map_or(text.len(), |i| i + 1)
                } else {
                    text.len()
                };
                out.extend_from_slice(&text[..end]);
            }
            Kind::Date => {
                let mut buf = [0u8; 64];
                out.extend_from_slice(value.to_iso_string(global, &mut buf).unwrap_or(b"Date { NaN }"));
            }
            Kind::Error => {
                // `Error.prototype.toString.call(value)`
                let name = member(global, value, "name")?;
                let message = member(global, value, "message")?;
                out.push(b'[');
                let start = out.len();
                if name.is_undefined() {
                    out.extend_from_slice(b"Error");
                } else {
                    write_string(global, out, name)?;
                }
                if !message.is_undefined() {
                    let name_end = out.len();
                    out.extend_from_slice(b": ");
                    write_string(global, out, message)?;
                    if out.len() == name_end + 2 {
                        out.truncate(name_end);
                    } else if name_end == start {
                        out.drain(start..start + 2);
                    }
                }
                out.push(b']');
            }
            Kind::RegExp => {
                // `RegExp.prototype.toString.call(value)`
                let mut text = vec![b'/'];
                write_string(global, &mut text, member(global, value, "source")?)?;
                text.push(b'/');
                write_string(global, &mut text, member(global, value, "flags")?)?;
                let mut rest = text.as_slice();
                while let Some(i) = strings::index_of_any(rest, b"$()*+.?[\\]^{|}") {
                    out.extend_from_slice(&rest[..i]);
                    out.extend_from_slice(&[b'\\', rest[i]]);
                    rest = &rest[i + 1..];
                }
                out.extend_from_slice(rest);
            }
            _ => {
                if self.ancestors.includes(value) {
                    out.extend_from_slice(b"[Circular]");
                    return Ok(());
                }
                self.ancestors.push(global, value)?;
                let result = self.print_complex_value(out, value, kind, has_called_to_json);
                self.ancestors.pop();
                return result;
            }
        }
        Ok(())
    }

    /// `printComplexValue`
    fn print_complex_value(
        &mut self,
        out: &mut Vec<u8>,
        value: JSValue,
        kind: Kind,
        has_called_to_json: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        // These have no `toJSON()` where Jest and Vitest run.
        let is_bun_extension = matches!(value.get_class_info_name(), Some(b"Headers" | b"FormData" | b"URLSearchParams"));
        if !has_called_to_json && !is_bun_extension {
            let to_json = member(global, value, "toJSON")?;
            if to_json.is_callable() {
                let json = to_json.call(global, value, &[])?;
                return self.print_like_pretty_format(out, json, true);
            }
        }

        match kind {
            Kind::Arguments => {
                out.extend_from_slice(b"Arguments [");
                self.print_list_items(out, value)?;
                out.push(b']');
            }
            Kind::List => {
                let name = member(global, member(global, value, "constructor")?, "name")?;
                if self.print_basic_prototype || !is_text(global, name, b"Array")? {
                    write_string(global, out, name)?;
                    out.push(b' ');
                }
                out.push(b'[');
                self.print_list_items(out, value)?;
                out.push(b']');
            }
            Kind::Map => {
                out.extend_from_slice(b"Map {");
                self.print_iterated(out, value, "entries", Some(b" => "))?;
                out.push(b'}');
            }
            Kind::Set => {
                out.extend_from_slice(b"Set {");
                self.print_iterated(out, value, "values", None)?;
                out.push(b'}');
            }
            _ if matches!(value.js_type(), JSType::GlobalProxy | JSType::GlobalObject) => {
                out.push(b'[');
                self.write_constructor_name(out, value, b"")?;
                out.truncate(out.len() - 1);
                out.push(b']');
            }
            _ => {
                self.write_constructor_name(out, value, b"Object")?;
                out.push(b'{');
                self.print_object_properties(out, value)?;
                out.push(b'}');
            }
        }
        Ok(())
    }

    /// `getConstructorName(value)` and a space, or nothing when it is `basic`.
    fn write_constructor_name(&mut self, out: &mut Vec<u8>, value: JSValue, basic: &[u8]) -> JsResult<()> {
        let global = self.global_this;
        let start = out.len();
        let constructor = member(global, value, "constructor")?;
        match if constructor.is_callable() { first_truthy(global, constructor, &["name"])? } else { None } {
            Some(name) => write_string(global, out, name)?,
            None => out.extend_from_slice(b"Object"),
        }
        if &out[start..] == basic && !self.print_basic_prototype {
            out.truncate(start);
        } else {
            out.push(b' ');
        }
        Ok(())
    }

    /// `printListItems`
    fn print_list_items(&mut self, out: &mut Vec<u8>, list: JSValue) -> JsResult<()> {
        use std::io::Write as _;
        let global = self.global_this;
        self.print_indented(out, &mut |this, out| {
            if matches!(list.js_type(), JSType::ArrayBuffer | JSType::DataView) {
                let Some(buffer) = list.as_array_buffer(global) else { return Ok(()) };
                for byte in buffer.byte_slice() {
                    this.new_line(out);
                    let _ = write!(out, "{},", *byte as i8);
                }
                return Ok(());
            }
            for i in 0..length_of(global, list)? {
                this.check_length(out.len())?;
                this.new_line(out);
                let value = if list.is_object() { item(global, list, i)? } else { JSValue::UNDEFINED };
                if !value.is_undefined() || has_index(global, list, i)? {
                    this.print_child(out, value)?;
                }
                out.push(b',');
            }
            Ok(())
        })
    }

    /// `printIteratorEntries` with a `separator`, `printIteratorValues` without, of `collection[method]()`.
    fn print_iterated(
        &mut self,
        out: &mut Vec<u8>,
        collection: JSValue,
        method: &'static str,
        separator: Option<&[u8]>,
    ) -> JsResult<()> {
        let global = self.global_this;
        let function = member(global, collection, method)?;
        self.print_indented(out, &mut |this, out| {
            let is_done = for_each_of_collection(global, collection, function, &mut |first, second| {
                this.new_line(out);
                this.print_child(out, first)?;
                if let Some(separator) = separator {
                    out.extend_from_slice(separator);
                    this.print_child(out, second)?;
                }
                out.push(b',');
                Ok(())
            })?;
            if is_done {
                return Ok(());
            }
            let iterator = call(global, function, collection, method, &[])?;
            loop {
                let current = call_method(global, iterator, "next", &[])?;
                if member(global, current, "done")?.to_boolean() {
                    return Ok(());
                }
                this.check_length(out.len())?;
                this.new_line(out);
                let value = member(global, current, "value")?;
                match separator {
                    Some(separator) => {
                        this.print_child(out, item(global, value, 0)?)?;
                        out.extend_from_slice(separator);
                        this.print_child(out, item(global, value, 1)?)?;
                    }
                    None => this.print_child(out, value)?,
                }
                out.push(b',');
            }
        })
    }

    /// `printObjectProperties`
    fn print_object_properties(&mut self, out: &mut Vec<u8>, object: JSValue) -> JsResult<()> {
        let global = self.global_this;
        self.print_indented(out, &mut |this, out| {
            for_each_sorted_property(global, object, this.snapshot_format, &mut |key, value| {
                this.new_line(out);
                this.print_child(out, key)?;
                out.extend_from_slice(b": ");
                this.print_child(out, value)?;
                out.push(b',');
                Ok(())
            })
        })
    }

    /// The serializer of mock functions, which jest-snapshot and Vitest both have.
    fn print_mock_function(&mut self, out: &mut Vec<u8>, mock_function: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let is_vitest = self.snapshot_format == SnapshotFormat::Vitest;
        let name = call_method(global, mock_function, "getMockName", &[])?;
        out.extend_from_slice(b"[MockFunction");
        if !is_text(global, name, if is_vitest { b"vi.fn()" } else { b"jest.fn()" })? {
            out.push(b' ');
            write_string(global, out, name)?;
        }
        out.push(b']');

        let calls = member(global, member(global, mock_function, "mock")?, "calls")?;
        let length = member(global, calls, "length")?;
        // Vitest: `length !== 0`. Jest: `length > 0`.
        if if is_vitest { length.is_number() && length.as_number() == 0.0 } else { !is_greater_than_zero(global, length)? } {
            return Ok(());
        }
        out.extend_from_slice(b" {");
        self.print_indented(out, &mut |this, out| {
            this.new_line(out);
            out.extend_from_slice(b"\"calls\": ");
            this.print_child(out, calls)?;
            out.push(b',');
            this.new_line(out);
            out.extend_from_slice(b"\"results\": ");
            this.print_child(out, member(global, member(global, mock_function, "mock")?, "results")?)?;
            out.push(b',');
            Ok(())
        })?;
        out.push(b'}');
        Ok(())
    }

    /// The `AsymmetricMatcher` plugin, for the matchers of `expect`.
    fn print_asymmetric_matcher_like_pretty_format(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        use std::io::Write as _;
        let global = self.global_this;
        let name = |flags: expect::Flags, is: &'static str, is_not: &'static str| -> &'static [u8] {
            (if flags.not() { is_not } else { is }).as_bytes()
        };
        if let Some(matcher) = value.as_class_ref::<expect::ExpectArrayContaining>() {
            let Some(sample) = expect_js::array_containing::array_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(name(matcher.flags.get(), "ArrayContaining [", "ArrayNotContaining ["));
            self.print_list_items(out, sample)?;
            out.push(b']');
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
            let Some(sample) = expect_js::object_containing::object_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(name(matcher.flags.get(), "ObjectContaining {", "ObjectNotContaining {"));
            self.print_object_properties(out, sample)?;
            out.push(b'}');
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
            let Some(sample) = expect_js::string_containing::string_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(name(matcher.flags.get(), "StringContaining ", "StringNotContaining "));
            self.print_child(out, sample)?;
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
            let Some(sample) = expect_js::string_matching::test_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(name(matcher.flags.get(), "StringMatching ", "StringNotMatching "));
            self.print_child(out, to_reg_exp(global, sample)?)?;
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
            let (Some(number), Some(digits)) =
                (expect_js::close_to::number_value_get_cached(value), expect_js::close_to::digits_value_get_cached(value))
            else {
                return Ok(false);
            };
            out.extend_from_slice(name(matcher.flags.get(), "NumberCloseTo ", "NumberNotCloseTo "));
            write_string(global, out, number)?;
            let digits = digits.to_int32();
            let _ = write!(out, " ({} digit{})", digits, if digits == 1 { "" } else { "s" });
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
            let (Some(arguments), Some(matcher_fn)) =
                (expect_js::custom::captured_args_get_cached(value), expect_js::custom::matcher_fn_get_cached(value))
            else {
                return Ok(false);
            };
            if matcher.flags.not() {
                out.extend_from_slice(b"not.");
            }
            out.extend_from_slice(matcher_fn.get_name(global)?.to_utf8().slice());
            out.push(b'<');
            let mut iter = arguments.array_iterator(global)?;
            while let Some(argument) = iter.next()? {
                if iter.i > 1 {
                    out.extend_from_slice(b", ");
                }
                if self.snapshot_format == SnapshotFormat::Vitest {
                    let outer = (core::mem::take(&mut self.indent), core::mem::replace(&mut self.print_basic_prototype, true));
                    let result = self.print_child(out, argument);
                    (self.indent, self.print_basic_prototype) = outer;
                    result?;
                } else {
                    out.extend_from_slice(argument.to_bun_string(global)?.to_utf8().slice());
                }
            }
            out.push(b'>');
        } else if value.as_class_ref::<expect::ExpectAny>().is_some() {
            let Some(constructor) = expect_js::any::constructor_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(b"Any<");
            let name = constructor.get_class_name(global)?;
            let name = name.to_utf8();
            out.extend_from_slice(if name.slice().is_empty() { b"<anonymous>" } else { name.slice() });
            out.push(b'>');
        } else if value.as_class_ref::<expect::ExpectAnything>().is_some() {
            out.extend_from_slice(b"Anything");
        } else {
            return Ok(false);
        }
        Ok(true)
    }

    /// The `AsymmetricMatcher` plugin, for a matcher of another library.
    #[cold]
    fn print_foreign_asymmetric_matcher(&mut self, out: &mut Vec<u8>, matcher: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let name = call_method(global, matcher, "toString", &[])?;
        let is_one_of = |names: &[&str]| -> JsResult<bool> {
            for known in names {
                if is_text(global, name, known.as_bytes())? {
                    return Ok(true);
                }
            }
            Ok(false)
        };
        if is_one_of(&["ArrayContaining", "ArrayNotContaining"])? {
            write_string(global, out, name)?;
            out.extend_from_slice(b" [");
            self.print_list_items(out, member(global, matcher, "sample")?)?;
            out.push(b']');
        } else if is_one_of(&["ObjectContaining", "ObjectNotContaining"])? {
            write_string(global, out, name)?;
            out.extend_from_slice(b" {");
            self.print_object_properties(out, member(global, matcher, "sample")?)?;
            out.push(b'}');
        } else if is_one_of(&["StringMatching", "StringNotMatching", "StringContaining", "StringNotContaining"])? {
            write_string(global, out, name)?;
            out.push(b' ');
            self.print_child(out, member(global, matcher, "sample")?)?;
        } else {
            let to_asymmetric_matcher = member(global, matcher, "toAsymmetricMatcher")?;
            if !to_asymmetric_matcher.is_callable() {
                let class = member(global, member(global, matcher, "constructor")?, "name")?.to_bun_string(global)?;
                return Err(global.throw_type_error(format_args!(
                    "Asymmetric matcher {class} does not implement toAsymmetricMatcher()"
                )));
            }
            write_printed_by_plugin(global, out, to_asymmetric_matcher.call(global, matcher, &[])?)?;
        }
        Ok(())
    }

    /// The `Immutable` plugin
    fn print_immutable(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        let global = self.global_this;
        let is_true = |name: &'static str| Ok::<bool, JsError>(member(global, value, name)? == JSValue::TRUE);
        if !is_true("@@__IMMUTABLE_ITERABLE__@@")? && !is_true("@@__IMMUTABLE_RECORD__@@")? {
            return Ok(false);
        }
        let has = |names: &[&'static str]| Ok::<bool, JsError>(first_truthy(global, value, names)?.is_some());
        let (name, keyed, listed): (&[u8], bool, bool) = if has(&["@@__IMMUTABLE_MAP__@@"])? {
            (if has(&["@@__IMMUTABLE_ORDERED__@@"])? { b"OrderedMap" } else { b"Map" }, true, true)
        } else if has(&["@@__IMMUTABLE_LIST__@@"])? {
            (b"List", false, true)
        } else if has(&["@@__IMMUTABLE_SET__@@"])? {
            (if has(&["@@__IMMUTABLE_ORDERED__@@"])? { b"OrderedSet" } else { b"Set" }, false, true)
        } else if has(&["@@__IMMUTABLE_STACK__@@"])? {
            (b"Stack", false, true)
        } else if !has(&["@@__IMMUTABLE_SEQ__@@"])? {
            return self.print_immutable_record(out, value).map(|()| true);
        } else if has(&["@@__IMMUTABLE_KEYED__@@"])? {
            (b"Seq", true, has(&["_iter", "_object"])?)
        } else {
            (b"Seq", false, has(&["_iter", "_array", "_collection", "_iterable"])?)
        };

        out.extend_from_slice(b"Immutable.");
        out.extend_from_slice(name);
        out.extend_from_slice(if keyed { b" {" } else { b" [" });
        if !listed {
            out.extend_from_slice("\u{2026}".as_bytes());
        } else if keyed {
            self.print_iterated(out, value, "entries", Some(b": "))?;
        } else {
            self.print_iterated(out, value, "values", None)?;
        }
        out.push(if keyed { b'}' } else { b']' });
        Ok(true)
    }

    fn print_immutable_record(&mut self, out: &mut Vec<u8>, record: JSValue) -> JsResult<()> {
        let global = self.global_this;
        out.extend_from_slice(b"Immutable.");
        match first_truthy(global, record, &["_name"])? {
            Some(name) => write_string(global, out, name)?,
            None => out.extend_from_slice(b"Record"),
        }
        out.extend_from_slice(b" {");
        self.print_indented(out, &mut |this, out| {
            let mut i = 0;
            // `_keys` and its length are read again for each key.
            while i < length_of(global, member(global, record, "_keys")?)? {
                let key = item(global, member(global, record, "_keys")?, i)?;
                i += 1;
                let value = call_method(global, record, "get", &[key])?;
                this.check_length(out.len())?;
                this.new_line(out);
                this.print_child(out, key)?;
                out.extend_from_slice(b": ");
                this.print_child(out, value)?;
                out.push(b',');
            }
            Ok(())
        })?;
        out.push(b'}');
        Ok(())
    }

    /// `printElement`, with the `printProps` of `Object.keys(props)` that are not `undefined`.
    fn print_markup(
        &mut self,
        out: &mut Vec<u8>,
        tag: &[u8],
        props: Option<JSValue>,
        skip_children_prop: bool,
        children: Option<JSValue>,
    ) -> JsResult<()> {
        let global = self.global_this;
        out.push(b'<');
        out.extend_from_slice(tag);

        let after_tag = out.len();
        self.indent += 1;
        let printed_props = props.map_or(Ok(()), |props| {
            for_each_sorted_property(global, props, self.snapshot_format, &mut |key, value| {
                if !key.is_string() || value.is_undefined() {
                    return Ok(());
                }
                let key = key.to_bun_string(global)?;
                if skip_children_prop && key.eq_ascii(b"children") {
                    return Ok(());
                }
                self.new_line(out);
                out.extend_from_slice(key.to_utf8().slice());
                out.push(b'=');
                // Between braces unless it is a string, and on lines of its own when it has several: it is printed
                // where those would put it, and moved back when it has one.
                let braces = !value.is_string_literal();
                let open = out.len() + 1;
                self.indent += 1;
                if braces {
                    out.push(b'{');
                    self.new_line(out);
                }
                let start = out.len();
                let result = self.print_child(out, value);
                self.indent -= 1;
                result?;
                if braces {
                    if strings::contains_char(&out[start..], b'\n') {
                        self.new_line(out);
                    } else {
                        out.drain(open..start);
                    }
                    out.push(b'}');
                }
                Ok(())
            })
        });
        self.indent -= 1;
        printed_props?;
        let has_props = out.len() != after_tag;
        if has_props {
            self.new_line(out);
        }

        let end_of_open_tag = out.len();
        out.push(b'>');
        if let Some(children) = children {
            self.indent += 1;
            let result = if skip_children_prop {
                self.print_flattened_children(out, children)
            } else {
                self.print_mapped_children(out, children)
            };
            self.indent -= 1;
            result?;
        }
        if out.len() == end_of_open_tag + 1 {
            out.truncate(end_of_open_tag);
            out.extend_from_slice(if has_props { b"/>" } else { b" />" });
            return Ok(());
        }
        self.new_line(out);
        out.extend_from_slice(b"</");
        out.extend_from_slice(tag);
        out.push(b'>');
        Ok(())
    }

    /// `printChildren(getChildren(child))`
    fn print_flattened_children(&mut self, out: &mut Vec<u8>, child: JSValue) -> JsResult<()> {
        let global = self.global_this;
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(global.throw_stack_overflow());
        }
        if is_array(global, child)? {
            for i in 0..length_of(global, child)? {
                self.print_flattened_children(out, item(global, child, i)?)?;
            }
            return Ok(());
        }
        if child.is_undefined_or_null() || child == JSValue::FALSE || (child.is_string_literal() && !child.to_boolean()) {
            return Ok(());
        }
        self.print_markup_child(out, child)
    }

    /// `printChildren(children)`, which is `children.map()`.
    fn print_mapped_children(&mut self, out: &mut Vec<u8>, children: JSValue) -> JsResult<()> {
        let global = self.global_this;
        if !is_array(global, children)? {
            return Err(global.throw_type_error(format_args!("children.map is not a function")));
        }
        for i in 0..length_of(global, children)? {
            if has_index(global, children, i)? {
                self.print_markup_child(out, item(global, children, i)?)?;
            }
        }
        Ok(())
    }

    fn print_markup_child(&mut self, out: &mut Vec<u8>, child: JSValue) -> JsResult<()> {
        let global = self.global_this;
        self.check_length(out.len())?;
        self.new_line(out);
        if !child.is_string_literal() {
            return self.print_child(out, child);
        }
        let text = child.to_bun_string(global)?;
        let text = text.to_utf8();
        let mut rest = text.slice();
        while let Some(i) = strings::index_of_any(rest, b"<>") {
            out.extend_from_slice(&rest[..i]);
            out.extend_from_slice(if rest[i] == b'<' { b"&lt;" } else { b"&gt;" });
            rest = &rest[i + 1..];
        }
        out.extend_from_slice(rest);
        Ok(())
    }

    /// The `ReactTestComponent` plugin
    fn print_react_test_json(&mut self, out: &mut Vec<u8>, object: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let tag = member(global, object, "type")?.to_bun_string(global)?;
        let props = Some(member(global, object, "props")?).filter(|props| props.to_boolean());
        let children = Some(member(global, object, "children")?).filter(|children| children.to_boolean());
        self.print_markup(out, tag.to_utf8().slice(), props, false, children)
    }

    /// The `ReactElement` plugin. `legacy`: an element of React 18 or older.
    fn print_react_element(&mut self, out: &mut Vec<u8>, element: JSValue, legacy: bool) -> JsResult<()> {
        let global = self.global_this;
        let tag = Self::react_type_name(global, member(global, element, "type")?, legacy)?;
        let props = member(global, element, "props")?;
        let children = if props.is_undefined_or_null() { None } else { Some(member(global, props, "children")?) };
        self.print_markup(out, &tag, Some(props), true, children)
    }

    /// `getType`
    fn react_type_name(global: &JSGlobalObject, type_: JSValue, legacy: bool) -> JsResult<Vec<u8>> {
        let text = |value: JSValue| -> JsResult<Vec<u8>> { Ok(value.to_bun_string(global)?.to_owned_slice()) };
        let wrapped = |wrapper: &str, name: Option<JSValue>| -> JsResult<Vec<u8>> {
            let mut wrapped = wrapper.as_bytes().to_vec();
            if let Some(name) = name {
                wrapped.push(b'(');
                wrapped.extend_from_slice(&text(name)?);
                wrapped.push(b')');
            }
            Ok(wrapped)
        };
        if type_.is_string_literal() {
            return text(type_);
        }
        if type_.is_callable() {
            return first_truthy(global, type_, &["displayName", "name"])?.map_or_else(|| Ok(b"Unknown".to_vec()), text);
        }
        let is = |symbol: JSValue, name: &'static [u8]| symbol.is_symbol() && symbol == JSValue::symbol_for(global, name);
        if is(type_, b"react.fragment") {
            return Ok(b"React.Fragment".to_vec());
        }
        if is(type_, b"react.suspense") {
            return Ok(b"React.Suspense".to_vec());
        }
        if type_.is_object() {
            let kind = member(global, type_, "$$typeof")?;
            if is(kind, if legacy { b"react.provider" } else { b"react.context" }) {
                return Ok(b"Context.Provider".to_vec());
            }
            if is(kind, if legacy { b"react.context" } else { b"react.consumer" }) {
                return Ok(b"Context.Consumer".to_vec());
            }
            if is(kind, b"react.forward_ref") {
                if let Some(name) = first_truthy(global, type_, &["displayName"])? {
                    return text(name);
                }
                return wrapped("ForwardRef", first_truthy(global, member(global, type_, "render")?, &["displayName", "name"])?);
            }
            if is(kind, b"react.memo") {
                let name = match first_truthy(global, type_, &["displayName"])? {
                    Some(name) => Some(name),
                    None => first_truthy(global, member(global, type_, "type")?, &["displayName", "name"])?,
                };
                return wrapped("Memo", name);
            }
        }
        Ok(b"UNDEFINED".to_vec())
    }
}

mod serializers_js {
    ::bun_jsc::codegen_cached_accessors!("ExpectMatcherUtils"; snapshotSerializers);
}

macro_rules! serializer_host_fn {
    ($shim:ident, $function:path) => {
        bun_jsc::jsc_host_abi! {
            unsafe fn $shim(global: *mut JSGlobalObject, frame: *mut jsc::CallFrame) -> JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let (global, frame) = unsafe { (&*global, &*frame) };
                bun_jsc::to_js_host_fn_result(global, $function(global, frame))
            }
        }
    };
}
serializer_host_fn!(printer_shim, JestPrettyFormat::printer);
serializer_host_fn!(print_child_shim, JestPrettyFormat::print_child);
serializer_host_fn!(indent_shim, JestPrettyFormat::indent);

/// `expect.addSnapshotSerializer()`
impl JestPrettyFormat {
    pub(crate) fn add_snapshot_serializer(global: &JSGlobalObject, frame: &jsc::CallFrame) -> JsResult<JSValue> {
        let [plugin] = frame.arguments_as_array::<1>();
        let is_function = |name: &str| Ok::<bool, JsError>(plugin.get(global, name)?.is_some_and(|value| value.is_callable()));
        if !plugin.is_object() || !is_function("test")? || !(is_function("serialize")? || is_function("print")?) {
            return Err(global.throw_invalid_argument_type_value(
                "serializer",
                "object with a test() and a serialize() or print() function",
                plugin,
            ));
        }

        let utils_value = expect::ExpectMatcherUtils::singleton(global);
        let Some(utils) = expect::ExpectMatcherUtils::from_js(utils_value) else { return Ok(JSValue::UNDEFINED) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };

        let is_of_file = expect::Expect::is_called_by_test_file(global, frame);
        let serializers = JSValue::create_empty_array(global, 0)?;
        serializers.push(global, plugin)?;
        if let Some(registered) = Self::serializers(global)? {
            let mut iter = registered.array_iterator(global)?;
            while let Some(earlier) = iter.next()? {
                // A helper that every test file calls registers its serializer once.
                if !is_of_file && earlier == plugin && utils.serializers_of_file.get().get(iter.i as usize - 1) == Some(&false) {
                    return Ok(JSValue::UNDEFINED);
                }
                serializers.push(global, earlier)?;
            }
        }
        serializers_js::snapshot_serializers_set_cached(utils_value, global, serializers);
        utils.serializers_of_file.with_mut(|of_file| of_file.insert(0, is_of_file));
        Ok(JSValue::UNDEFINED)
    }

    /// The last added first. Those that the code of a test file added end with the file.
    fn serializers(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        let utils_value = expect::ExpectMatcherUtils::singleton(global);
        let Some(utils) = expect::ExpectMatcherUtils::from_js(utils_value) else { return Ok(None) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };
        let file = super::jest::Jest::file_generation(global);
        let is_same_file = utils.serializers_file.replace(file) == file;
        let Some(serializers) = serializers_js::snapshot_serializers_get_cached(utils_value) else {
            return Ok(None);
        };
        if is_same_file || !utils.serializers_of_file.get().contains(&true) {
            return Ok(Some(serializers));
        }

        let of_file = utils.serializers_of_file.replace(Vec::new());
        let kept = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        let mut iter = serializers.array_iterator(global)?;
        for is_of_file in of_file {
            let Some(serializer) = iter.next()? else { break };
            if !is_of_file {
                kept.put_index(global, count, serializer)?;
                count += 1;
            }
        }
        utils.serializers_of_file.set(vec![false; count as usize]);
        if count == 0 {
            serializers_js::snapshot_serializers_set_cached(utils_value, global, JSValue::ZERO);
            return Ok(None);
        }
        serializers_js::snapshot_serializers_set_cached(utils_value, global, kept);
        Ok(Some(kept))
    }

    /// The `printer` that a serializer is given.
    fn printer(global: &JSGlobalObject, frame: &jsc::CallFrame) -> JsResult<JSValue> {
        let [value, config, indentation, _depth, refs, has_called_to_json] = frame.arguments_as_array::<6>();
        Self::print_for_serializer(global, value, config, indentation, refs, has_called_to_json.to_boolean())
    }

    /// The `print` that a serializer with the older interface is given, after what it is bound to.
    fn print_child(global: &JSGlobalObject, frame: &jsc::CallFrame) -> JsResult<JSValue> {
        let [config, indentation, refs, value] = frame.arguments_as_array::<4>();
        Self::print_for_serializer(global, value, config, indentation, refs, false)
    }

    /// Its `indent`, likewise.
    fn indent(global: &JSGlobalObject, frame: &jsc::CallFrame) -> JsResult<JSValue> {
        let [indentation, text] = frame.arguments_as_array::<2>();
        let indentation = indentation.to_bun_string(global)?.to_owned_slice();
        let mut indented = indentation.clone();
        indent_lines(&mut indented, text.to_bun_string(global)?.to_utf8().slice(), &indentation);
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &indented)
    }

    fn print_for_serializer(
        global: &JSGlobalObject,
        value: JSValue,
        config: JSValue,
        indentation: JSValue,
        refs: JSValue,
        has_called_to_json: bool,
    ) -> JsResult<JSValue> {
        let mut formatter = Formatter::new(global);
        formatter.snapshot_format = SnapshotFormat::Jest;
        if config.is_object() {
            formatter.config = Some(config);
            if first_truthy(global, config, &["printShadowRoot"])?.is_some() {
                formatter.snapshot_format = SnapshotFormat::Vitest;
            }
            formatter.serializers = config.get(global, "plugins")?.filter(|plugins| plugins.is_array());
        }
        if refs.is_array() {
            let mut iter = refs.array_iterator(global)?;
            while let Some(ancestor) = iter.next()? {
                formatter.ancestors.push(global, ancestor)?;
            }
        }
        let indentation = if indentation.is_string() { indentation.to_bun_string(global)?.to_owned_slice() } else { Vec::new() };
        let is_levels = indentation.len() % 2 == 0 && indentation.iter().all(|byte| *byte == b' ');
        if is_levels {
            formatter.indent = (indentation.len() / 2) as u32;
        }

        let mut printed = Vec::new();
        formatter.print_like_pretty_format(&mut printed, value, has_called_to_json)?;
        if !is_levels {
            let mut indented = Vec::new();
            indent_lines(&mut indented, &printed, &indentation);
            printed = indented;
        }
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &printed)
    }
}

/// `text`, with `indentation` after each of its line breaks.
fn indent_lines(out: &mut Vec<u8>, text: &[u8], indentation: &[u8]) {
    let mut rest = text;
    while let Some(i) = strings::index_of_char_usize(rest, b'\n') {
        out.extend_from_slice(&rest[..=i]);
        out.extend_from_slice(indentation);
        rest = &rest[i + 1..];
    }
    out.extend_from_slice(rest);
}

impl Formatter<'_> {
    /// `findPlugin` and `printPlugin`
    #[cold]
    #[inline(never)]
    fn print_with_serializer(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        let global = self.global_this;
        let Some(serializers) = self.serializers else { return Ok(false) };
        let mut iter = serializers.array_iterator(global)?;
        while let Some(plugin) = iter.next()? {
            if !plugin.is_object() {
                continue;
            }
            let Some(test) = plugin.get(global, "test")?.filter(|test| test.is_callable()) else { continue };
            if !test.call(global, plugin, &[value])?.to_boolean() {
                continue;
            }
            let printed = self.call_serializer(plugin, value)?;
            write_printed_by_plugin(global, out, printed)?;
            return Ok(true);
        }
        Ok(false)
    }

    fn call_serializer(&mut self, plugin: JSValue, value: JSValue) -> JsResult<JSValue> {
        let global = self.global_this;
        let text = |text: &'static str| bun_core::String::static_(text).to_js(global);
        let spaces = |levels: u32| bun_jsc::bun_string_jsc::create_utf8_for_js(global, &vec![b' '; levels as usize * 2]);

        let config = if let Some(config) = self.config {
            config
        } else {
            let no_color = JSValue::create_empty_object(global, 2);
            no_color.put(global, b"close", text("")?);
            no_color.put(global, b"open", text("")?);
            let colors = JSValue::create_empty_object(global, 5);
            for name in [&b"comment"[..], b"content", b"prop", b"tag", b"value"] {
                colors.put(global, name, no_color);
            }
            let config = JSValue::create_empty_object(global, 14);
            config.put(global, b"callToJSON", JSValue::TRUE);
            config.put(global, b"colors", colors);
            config.put(global, b"compareKeys", JSValue::UNDEFINED);
            config.put(global, b"escapeRegex", JSValue::TRUE);
            config.put(global, b"escapeString", JSValue::FALSE);
            config.put(global, b"indent", text("  ")?);
            config.put(global, b"maxDepth", JSValue::js_number(f64::INFINITY));
            config.put(global, b"maxWidth", JSValue::js_number(f64::INFINITY));
            config.put(global, b"min", JSValue::FALSE);
            config.put(global, b"plugins", self.serializers.unwrap_or(JSValue::UNDEFINED));
            config.put(global, b"printBasicPrototype", JSValue::FALSE);
            config.put(global, b"printFunctionName", JSValue::FALSE);
            config.put(global, b"spacingInner", text("\n")?);
            config.put(global, b"spacingOuter", text("\n")?);
            if self.snapshot_format == SnapshotFormat::Vitest {
                config.put(global, b"printShadowRoot", JSValue::TRUE);
            }
            self.config = Some(config);
            config
        };
        let indentation = spaces(self.indent)?;
        let refs = self.ancestors.to_js_array(global)?;

        if let Some(serialize) = plugin.get(global, "serialize")?.filter(|serialize| serialize.is_callable()) {
            let depth = JSValue::js_number(f64::from(self.ancestors.len));
            let printer = jsc::JSFunction::create(global, "printer", printer_shim, 6, Default::default());
            return serialize.call(global, plugin, &[value, config, indentation, depth, refs, printer]);
        }

        let Some(print) = plugin.get(global, "print")?.filter(|print| print.is_callable()) else {
            return Ok(JSValue::UNDEFINED);
        };
        let print_child = jsc::JSFunction::create(global, "print", print_child_shim, 1, Default::default()).bind(
            global,
            JSValue::UNDEFINED,
            &bun_core::String::static_("print"),
            1.0,
            &[config, indentation, refs],
        )?;
        let indent = jsc::JSFunction::create(global, "indent", indent_shim, 1, Default::default()).bind(
            global,
            JSValue::UNDEFINED,
            &bun_core::String::static_("indent"),
            1.0,
            &[spaces(self.indent + 1)?],
        )?;
        let options = JSValue::create_empty_object(global, 3);
        options.put(global, b"edgeSpacing", text("\n")?);
        options.put(global, b"min", JSValue::FALSE);
        options.put(global, b"spacing", text("\n")?);
        let colors = config.get(global, "colors")?.unwrap_or(JSValue::UNDEFINED);
        print.call(global, plugin, &[value, print_child, indent, options, colors])
    }
}
