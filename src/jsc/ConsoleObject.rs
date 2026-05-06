//! Port of `src/jsc/ConsoleObject.zig`.
//!
//! Implements `console.*` printing for the Bun runtime: type-tag dispatch,
//! recursive value formatting, table printing, `%`-format specifier handling,
//! `console.count`/`time`/`timeEnd`, and the C ABI shims that JavaScriptCore
//! calls into.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::fmt::Write as _;

use bun_collections::HashMap;
use bun_core::{Environment, Output, StackCheck};
use crate as jsc;
use crate::{
    CallFrame, EventType, JSGlobalObject, JSPromise, JSValue, JsResult,
    ZigException, ZigString,
};
use crate::virtual_machine::VirtualMachine;
use bun_string::{self as strings, String as BunString};

// High-tier deps (CLI command-line, JS lexer/printer, Jest pretty-format) —
// gated; bodies that reference them are gated below.
// TODO(port): bun_runtime / bun_js_parser cycle.
#[cfg(any())] use bun_runtime::cli::Command as CLI;
#[cfg(any())] use bun_runtime::test_runner::pretty_format::JestPrettyFormat;

/// Thin facade over `bun_js_parser::lexer` / `bun_js_printer` so the call
/// sites below keep their Zig spelling (`JSLexer.isLatin1Identifier`,
/// `JSPrinter.writeJsonString`) while the underlying crates expose slightly
/// different shapes (single generic identifier predicate; const-generic
/// encoding on `write_json_string`).
mod JSLexer {
    #[inline]
    pub fn is_latin1_identifier_u8(name: &[u8]) -> bool {
        bun_js_parser::lexer::is_latin1_identifier(name)
    }
    /// Zig `isLatin1Identifier(comptime []const u16, name)` — same predicate
    /// over a UTF-16 slice. `bun_js_printer` has a private copy; reproduce
    /// the (tiny) check here rather than widen its visibility.
    pub fn is_latin1_identifier_u16(name: &[u16]) -> bool {
        if name.is_empty() { return false; }
        let c0 = name[0];
        if !(c0 == b'_' as u16 || c0 == b'$' as u16
            || (b'a' as u16..=b'z' as u16).contains(&c0)
            || (b'A' as u16..=b'Z' as u16).contains(&c0))
        { return false; }
        name[1..].iter().all(|&c| {
            c == b'_' as u16 || c == b'$' as u16
                || (b'a' as u16..=b'z' as u16).contains(&c)
                || (b'A' as u16..=b'Z' as u16).contains(&c)
                || (b'0' as u16..=b'9' as u16).contains(&c)
        })
    }
}
mod JSPrinter {
    pub use bun_js_printer::Encoding;
    /// Runtime-encoding adapter over `bun_js_printer::write_json_string`,
    /// which takes `Encoding` as a const generic.
    #[inline]
    pub fn write_json_string(
        input: &[u8],
        writer: &mut (impl bun_io::Write + ?Sized),
        encoding: Encoding,
    ) -> Result<(), bun_core::Error> {
        match encoding {
            Encoding::Latin1 => bun_js_printer::write_json_string::<_, { Encoding::Latin1 }>(input, writer),
            Encoding::Utf8   => bun_js_printer::write_json_string::<_, { Encoding::Utf8   }>(input, writer),
            Encoding::Ascii  => bun_js_printer::write_json_string::<_, { Encoding::Ascii  }>(input, writer),
            Encoding::Utf16  => bun_js_printer::write_json_string::<_, { Encoding::Utf16  }>(input, writer),
        }
    }
}

/// Local front for `bun_core::pretty_fmt!` that accepts a runtime / const-
/// generic bool. Zig's `Output.prettyFmt(comptime fmt, comptime enable_colors)`
/// took a comptime bool; the Rust macro only matches `true`/`false` literals,
/// so monomorphized callers (`<const C: bool>`) branch here.
// PERF(port): was comptime bool dispatch — both arms are `&'static str`.
macro_rules! pfmt {
    ($fmt:expr, $colors:expr) => {
        if $colors { ::bun_core::pretty_fmt!($fmt, true) } else { ::bun_core::pretty_fmt!($fmt, false) }
    };
}

// ───────────────────────────────────────────────────────────────────────────
// ConsoleObject
// ───────────────────────────────────────────────────────────────────────────

/// Opaque FFI handle for `Inspector::ScriptArguments`.
#[repr(C)]
pub struct ScriptArguments {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// Default depth for `console.log` object inspection.
/// Only `--console-depth` CLI flag and `console.depth` bunfig option should modify this.
const DEFAULT_CONSOLE_LOG_DEPTH: u16 = 2;

type Counter = HashMap<u64, u32>;

pub struct ConsoleObject {
    stderr_buffer: [u8; 4096],
    stdout_buffer: [u8; 4096],

    // TODO(port): Zig stores `Adapter` structs for the old→new `std.Io.Writer`
    // bridge plus self-referential `*std.Io.Writer` pointers into them. In Rust
    // we restructure as direct buffered writer fields and expose them via
    // `error_writer()` / `writer()` getters (LIFETIMES.tsv: BORROW_FIELD →
    // self-ref; restructure as getter).
    error_writer_backing: Output::QuietWriterAdapter,
    writer_backing: Output::QuietWriterAdapter,

    pub default_indent: u16,

    counts: Counter,

    // The writer adapters above hold raw pointers into `{stderr,stdout}_buffer`;
    // moving the struct would dangle them. `PhantomPinned` opts out of `Unpin`
    // so `Pin<Box<Self>>` (returned by `init`) actually enforces that.
    _pin: core::marker::PhantomPinned,
}

impl core::fmt::Display for ConsoleObject {
    fn fmt(&self, _: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Zig: `pub fn format(...) !void {}` — intentionally prints nothing.
        Ok(())
    }
}

impl ConsoleObject {
    // PORT NOTE: `adapt_to_new_api(&mut self.stderr_buffer)` captures a raw
    // pointer into the buffer field, so the struct is self-referential once
    // initialized. The previous out-param shape (`&mut MaybeUninit<Self>`)
    // still let the caller move the value afterwards (e.g.
    // `Box::new(unsafe { mu.assume_init() })`), which is exactly what
    // `VirtualMachine` needs to do — and that move would dangle both
    // adapter pointers.
    //
    // Instead, allocate the storage here and return it pinned:
    // `Pin<Box<Self>>` puts the 8 KiB of buffers at a stable heap address
    // before the adapters are wired up, and the `Pin` makes the
    // "must not move" invariant a type-system fact rather than a comment.
    // `VirtualMachine.console` stores the raw pointer (`*mut c_void`), so
    // callers leak via `Box::into_raw(Pin::into_inner_unchecked(..))` — the
    // VM owns it for the process lifetime.
    //
    // TODO(port): Phase B — make `QuietWriterAdapter` own its 4 KiB buffer so
    // the self-reference disappears and this can become `-> Self`.
    pub fn init(
        error_writer: Output::StreamType,
        writer: Output::StreamType,
    ) -> core::pin::Pin<Box<ConsoleObject>> {
        let mut out = Box::new(ConsoleObject {
            stderr_buffer: [0; 4096],
            stdout_buffer: [0; 4096],
            error_writer_backing: Output::QuietWriterAdapter::uninit(),
            writer_backing: Output::QuietWriterAdapter::uninit(),
            default_indent: 0,
            counts: Counter::default(),
            _pin: core::marker::PhantomPinned,
        });
        // SAFETY: `out` is heap-allocated at its final address; the adapters
        // store raw pointers into `out.{stderr,stdout}_buffer`, which remain
        // valid for the box's lifetime. We split the borrow through a raw
        // pointer because `adapt_to_new_api` would otherwise hold a unique
        // borrow of one field while we assign another.
        let p: *mut ConsoleObject = &mut *out;
        unsafe {
            (*p).error_writer_backing =
                error_writer.quiet_writer().adapt_to_new_api(&mut (*p).stderr_buffer);
            (*p).writer_backing =
                writer.quiet_writer().adapt_to_new_api(&mut (*p).stdout_buffer);
        }
        Box::into_pin(out)
    }

    /// Out-param variant kept for callers that already own pinned storage
    /// (e.g. a static / arena slot). The address of `*out` MUST be stable for
    /// the value's entire lifetime — moving it afterwards leaves the writer
    /// adapters dangling. Prefer [`init`](Self::init) for new code.
    pub fn init_in_place(
        out: &mut core::mem::MaybeUninit<ConsoleObject>,
        error_writer: Output::StreamType,
        writer: Output::StreamType,
    ) -> &mut ConsoleObject {
        let out = out.write(ConsoleObject {
            stderr_buffer: [0; 4096],
            stdout_buffer: [0; 4096],
            error_writer_backing: Output::QuietWriterAdapter::uninit(),
            writer_backing: Output::QuietWriterAdapter::uninit(),
            default_indent: 0,
            counts: Counter::default(),
            _pin: core::marker::PhantomPinned,
        });
        // SAFETY: `out` is now fully initialized at its final address; the
        // adapters store raw pointers into `out.stderr_buffer` /
        // `out.stdout_buffer`, which remain valid for `out`'s lifetime
        // *provided the caller never moves it* (see fn doc).
        let p: *mut ConsoleObject = out;
        unsafe {
            (*p).error_writer_backing =
                error_writer.quiet_writer().adapt_to_new_api(&mut (*p).stderr_buffer);
            (*p).writer_backing =
                writer.quiet_writer().adapt_to_new_api(&mut (*p).stdout_buffer);
        }
        out
    }

    /// Replacement for Zig's self-referential `error_writer: *std.Io.Writer`.
    #[inline]
    pub fn error_writer(&mut self) -> &mut bun_core::io::Writer {
        self.error_writer_backing.new_interface()
    }

    /// Replacement for Zig's self-referential `writer: *std.Io.Writer`.
    #[inline]
    pub fn writer(&mut self) -> &mut bun_core::io::Writer {
        self.writer_backing.new_interface()
    }
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum MessageLevel {
    Log = 0,
    Warning = 1,
    Error = 2,
    Debug = 3,
    Info = 4,
    // Zig: `_` (non-exhaustive). Phase B may need a raw `u32` newtype if C++
    // ever passes out-of-range values.
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
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
}

// ───────────────────────────────────────────────────────────────────────────
// Body — format2 / TablePrinter / Formatter::print_as / C-exported
// Bun__ConsoleObject__* shims. The high-tier-cycle deps (bun_runtime: CLI,
// JSLexer, JSPrinter, JestPrettyFormat) remain individually -
// gated at their use sites; everything else is live.
// ───────────────────────────────────────────────────────────────────────────

use bun_threading::Mutex;

/// `globalThis.bunVM().console` — `VirtualMachine.console` is currently typed
/// `*mut c_void` (the `Box<ConsoleObject>` is erased to break the dep cycle
/// while `VirtualMachine.rs` is half-gated). This is the single re-entry point
/// that casts it back; every body below goes through it instead of touching
/// the field directly.
#[inline]
fn vm_console(global: &JSGlobalObject) -> *mut ConsoleObject {
    // SAFETY: `VirtualMachine.console` is initialized once at VM construction
    // (see `init` above — written into stable boxed storage) and lives for the
    // VM's lifetime; the C++ side never calls into `Bun__ConsoleObject__*`
    // before that. Returned as a raw pointer (not `&'static mut`) so callers
    // dereference at each use site without holding overlapping `&mut`
    // references — matches the Zig shape (`*ConsoleObject` field).
    unsafe { (*global.bun_vm()).console as *mut ConsoleObject }
}

/// Newtype adapter so `bun_core::io::Writer` (vtable-struct) satisfies the
/// `bun_io::Write` trait. Both error types are `bun_core::Error`, so this is a
/// straight delegation. Kept local to avoid an orphan-rule edit in `bun_core`.
struct IoWriterAdapter<'a>(&'a mut bun_core::io::Writer);
impl bun_io::Write for IoWriterAdapter<'_> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.0.write_all(buf)
    }
    #[inline]
    fn flush(&mut self) -> bun_io::Result<()> {
        self.0.flush()
    }
}

static STDERR_MUTEX: Mutex = Mutex::new();
static STDOUT_MUTEX: Mutex = Mutex::new();

thread_local! {
    static STDERR_LOCK_COUNT: Cell<u16> = const { Cell::new(0) };
    static STDOUT_LOCK_COUNT: Cell<u16> = const { Cell::new(0) };
}

/// <https://console.spec.whatwg.org/#formatter>
#[crate::host_call]
pub extern "C" fn message_with_type_and_level(
    ctype: *mut ConsoleObject,
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) {
    if let Err(err) =
        message_with_type_and_level_(ctype, message_type, level, global, vals, len)
    {
        // The exception is already set on the VM (`JsError::Thrown`); for OOM
        // make sure something is pending. Mirrors `host_fn::void_from_js_error`.
        if matches!(err, jsc::JsError::OutOfMemory) {
            global.throw_out_of_memory_value();
        }
        debug_assert!(global.has_exception());
    }
}

fn message_with_type_and_level_(
    _ctype: *mut ConsoleObject,
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) -> JsResult<()> {
    let console: *mut ConsoleObject = vm_console(global);
    // `defer console.default_indent +|= (message_type == StartGroup) as u16;`
    // Capture the raw pointer (Copy) so no `&mut ConsoleObject` is held across
    // the body; dereference only at scope-exit.
    let indent_guard = scopeguard::guard((), move |_| unsafe {
        (*console).default_indent = (*console)
            .default_indent
            .saturating_add((message_type == MessageType::StartGroup) as u16);
    });

    if message_type == MessageType::StartGroup && len == 0 {
        // undefined is printed if passed explicitly.
        drop(indent_guard);
        return Ok(());
    }

    if message_type == MessageType::EndGroup {
        unsafe {
            (*console).default_indent = (*console).default_indent.saturating_sub(1);
        }
        drop(indent_guard);
        return Ok(());
    }

    // Lock/unlock a mutex incase two JS threads are console.log'ing at the same
    // time. We do this the slightly annoying way to avoid assigning a pointer.
    let use_stderr = matches!(level, MessageLevel::Warning | MessageLevel::Error)
        || message_type == MessageType::Assert;
    if use_stderr {
        STDERR_LOCK_COUNT.with(|c| {
            if c.get() == 0 {
                STDERR_MUTEX.lock();
            }
            c.set(c.get() + 1);
        });
    } else {
        STDOUT_LOCK_COUNT.with(|c| {
            if c.get() == 0 {
                STDOUT_MUTEX.lock();
            }
            c.set(c.get() + 1);
        });
    }

    let _unlock = scopeguard::guard((), move |_| {
        if use_stderr {
            STDERR_LOCK_COUNT.with(|c| {
                c.set(c.get() - 1);
                if c.get() == 0 {
                    STDERR_MUTEX.unlock();
                }
            });
        } else {
            STDOUT_LOCK_COUNT.with(|c| {
                c.set(c.get() - 1);
                if c.get() == 0 {
                    STDOUT_MUTEX.unlock();
                }
            });
        }
    });

    if message_type == MessageType::Clear {
        Output::reset_terminal();
        drop(indent_guard);
        return Ok(());
    }

    if message_type == MessageType::Assert && len == 0 {
        let text: &str = if Output::enable_ansi_colors_stderr() {
            pfmt!("<r><red>Assertion failed<r>\n", true)
        } else {
            "Assertion failed\n"
        };
        let _ = unsafe { (*console).error_writer() }.write_all(text.as_bytes());
        let _ = unsafe { (*console).error_writer() }.flush();
        drop(indent_guard);
        return Ok(());
    }

    let enable_colors = if matches!(level, MessageLevel::Warning | MessageLevel::Error) {
        Output::enable_ansi_colors_stderr()
    } else {
        Output::enable_ansi_colors_stdout()
    };

    let raw_writer: &mut bun_core::io::Writer =
        if matches!(level, MessageLevel::Warning | MessageLevel::Error) {
            unsafe { (*console).error_writer() }
        } else {
            unsafe { (*console).writer() }
        };
    let mut writer_adapter = IoWriterAdapter(raw_writer);
    let writer: &mut dyn bun_io::Write = &mut writer_adapter;

    // TODO(port-cycle): `crate::Jest::runner()?.bun_test_root.on_before_print()`
    // — Jest runner lives in `bun_runtime` (high-tier cycle); restored when
    // the test-runner crate split lands.
    #[cfg(any())]
    if let Some(runner) = crate::Jest::runner() {
        runner.bun_test_root.on_before_print();
    }

    let mut print_length = len;
    // Get console depth from CLI options or bunfig, fallback to default.
    // TODO(port-cycle): `CLI::get().runtime_options.console_depth` — `CLI`
    // (`bun_runtime::cli::Command`) is a high-tier cycle dep. Until the CLI
    // context is plumbed through `VirtualMachine`, fall back to the default.
    #[cfg(any())]
    let console_depth = CLI::get()
        .runtime_options
        .console_depth
        .unwrap_or(DEFAULT_CONSOLE_LOG_DEPTH);
    #[cfg(not(any()))]
    let console_depth = DEFAULT_CONSOLE_LOG_DEPTH;

    let mut print_options = FormatOptions {
        enable_colors,
        add_newline: true,
        flush: true,
        default_indent: unsafe { (*console).default_indent },
        max_depth: console_depth,
        error_display_level: match level {
            MessageLevel::Error => ErrorDisplayLevel::Full,
            MessageLevel::Warning => ErrorDisplayLevel::Warn,
            _ => ErrorDisplayLevel::Normal,
        },
        ..FormatOptions::default()
    };

    // SAFETY: caller (JSC C++) guarantees `vals` points to `len` JSValues.
    let vals_slice = unsafe { core::slice::from_raw_parts(vals, len) };

    if message_type == MessageType::Table && len >= 1 {
        // if value is not an object/array/iterable, don't print a table and just print it
        let tabular_data = vals_slice[0];
        if tabular_data.is_object() {
            let properties: JSValue = if len >= 2 && vals_slice[1].js_type().is_array() {
                vals_slice[1]
            } else {
                JSValue::UNDEFINED
            };
            let mut table_printer = TablePrinter::init(global, level, tabular_data, properties)?;
            table_printer.value_formatter.indent += u32::from(unsafe { (*console).default_indent });

            if enable_colors {
                let _ = table_printer.print_table::<true>(writer);
            } else {
                let _ = table_printer.print_table::<false>(writer);
            }
            let _ = writer.flush();
            drop(indent_guard);
            return Ok(());
        }
    }

    if message_type == MessageType::Dir && len >= 2 {
        print_length = 1;
        let opts = vals_slice[1];
        if opts.is_object() {
            if let Some(depth_prop) = opts.get(global, b"depth")? {
                if depth_prop.is_int32() || depth_prop.is_number() || depth_prop.is_big_int() {
                    // Match Zig `JSValue.toU16`: `@truncate(@max(toInt32(), 0))`
                    // — clamp negatives to 0, then truncate (not saturate) to u16.
                    print_options.max_depth = depth_prop.to_int32().max(0) as u32 as u16;
                } else if depth_prop.is_null() {
                    print_options.max_depth = u16::MAX;
                }
            }
            if let Some(colors_prop) = opts.get(global, b"colors")? {
                if colors_prop.is_boolean() {
                    print_options.enable_colors = colors_prop.to_boolean();
                }
            }
        }
    }

    if print_length > 0 {
        format2(level, global, vals, print_length, writer, print_options)?;
    } else if message_type == MessageType::Log {
        let _ = unsafe { (*console).writer() }.write_all(b"\n");
        let _ = unsafe { (*console).writer() }.flush();
    } else if message_type != MessageType::Trace {
        let _ = writer.write_all(b"undefined\n");
    }

    if message_type == MessageType::Trace {
        write_trace(writer, global);
        let _ = writer.flush();
    }

    drop(indent_guard);
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// TablePrinter
// ───────────────────────────────────────────────────────────────────────────

pub struct TablePrinter<'a> {
    global_object: &'a JSGlobalObject,
    level: MessageLevel,
    value_formatter: Formatter<'a>,

    tabular_data: JSValue,
    properties: JSValue,

    is_iterable: bool,
    jstype: jsc::JSType,

    /// Width of the "Values" column. This column is not appended to "columns"
    /// from the start, because it needs to be the last column.
    values_col_width: Option<u32>,

    values_col_idx: usize,
}

struct Column {
    name: BunString,
    width: u32,
}

impl Default for Column {
    fn default() -> Self {
        Self { name: BunString::empty(), width: 1 }
    }
}

enum RowKey {
    Str(BunString),
    Num(u32),
}

const PADDING: u32 = 1;

impl<'a> TablePrinter<'a> {
    pub fn init(
        global_object: &'a JSGlobalObject,
        level: MessageLevel,
        tabular_data: JSValue,
        properties: JSValue,
    ) -> JsResult<Self> {
        Ok(TablePrinter {
            level,
            global_object,
            tabular_data,
            properties,
            // TODO(phase-c): `JSValue::is_iterable` not yet ported; treat as
            // non-iterable so the property-iterator path is taken.
            is_iterable: { let _ = global_object; false },
            jstype: tabular_data.js_type(),
            value_formatter: {
                // PORT NOTE: `Formatter` has a `Drop` impl, so struct-update
                // from a temporary is rejected (E0509).
                let mut f = Formatter::new(global_object);
                f.single_line = true;
                f.max_depth = 5;
                f.can_throw_stack_overflow = true;
                f.stack_check = StackCheck::init();
                f
            },
            values_col_width: None,
            values_col_idx: usize::MAX,
        })
    }
}

/// A `Write` sink that counts visible terminal columns instead of bytes.
struct VisibleCharacterCounter<'a> {
    width: &'a mut usize,
}

impl bun_io::Write for VisibleCharacterCounter<'_> {
    fn write_all(&mut self, bytes: &[u8]) -> bun_io::Result<()> {
        *self.width += strings::immutable::visible::width::exclude_ansi_colors::utf8(bytes);
        Ok(())
    }
}

impl<'a> TablePrinter<'a> {
    /// Phase-C stub for the gated `print_table` body below — falls through to
    /// the value formatter so `console.table()` prints *something* and the
    /// build links. Real impl restored once `JSValue` iteration helpers land.
    pub fn print_table<const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut dyn bun_io::Write,
    ) -> JsResult<()> {
        let global = self.global_object;
        let mut value_formatter = self.value_formatter.shallow_clone();
        let tag = formatter::Tag::get(self.tabular_data, global)?;
        value_formatter
            .format::<ENABLE_ANSI_COLORS>(tag, writer, self.tabular_data, global)?;
        let _ = writer.write_all(b"\n");
        Ok(())
    }
}

// TODO(phase-c): re-gated — body references unported `JSValue` iteration
// surface (`is_iterable`, `for_each_with_context`, `to_object`, `get_own`,
// `to_cell`) and `jsc::PropertyIteratorOptions` (~30 errs). Stub `print_table`
// provided above; restore once the missing iterator helpers land.
#[cfg(any())]
impl<'a> TablePrinter<'a> {
    /// Compute how much horizontal space a `JSValue` will take when printed.
    fn get_width_for_value(&mut self, value: JSValue) -> JsResult<u32> {
        let mut width: usize = 0;
        // PERF(port): Zig used a 512-byte discard buffer between the generic
        // writer adapter and the counter to amortize vtable calls; here we
        // write straight into the counter. Profile in Phase B.
        let mut counter = VisibleCharacterCounter { width: &mut width };
        let mut value_formatter = self.value_formatter.shallow_clone();

        let tag = formatter::Tag::get(value, self.global_object)?;
        value_formatter.quote_strings =
            !(matches!(tag.tag, TagPayload::String | TagPayload::StringPossiblyFormatted));
        let _ = value_formatter.format::<false>(tag, &mut counter, value, self.global_object);
        // VisibleCharacterCounter write cannot fail.
        let _ = counter.flush();

        Ok(width as u32)
    }

    /// Update the sizes of the columns for the values of a given row, and
    /// create any additional columns as needed.
    fn update_columns_for_row(
        &mut self,
        columns: &mut Vec<Column>,
        row_key: RowKey,
        row_value: JSValue,
    ) -> JsResult<()> {
        // update size of "(index)" column
        let row_key_len: u32 = match &row_key {
            RowKey::Str(value) => u32::try_from(value.visible_width_exclude_ansi_colors(false)).unwrap(),
            RowKey::Num(value) => bun_core::fmt::fast_digit_count(u64::from(*value)) as u32,
        };
        columns[0].width = columns[0].width.max(row_key_len);

        // special handling for Map: column with idx=1 is "Keys"
        if self.jstype.is_map() {
            let entry_key = row_value.get_index(self.global_object, 0)?;
            let entry_value = row_value.get_index(self.global_object, 1)?;
            columns[1].width = columns[1].width.max(self.get_width_for_value(entry_key)?);
            self.values_col_width =
                Some(self.values_col_width.unwrap_or(0).max(self.get_width_for_value(entry_value)?));
            return Ok(());
        }

        if let Some(obj) = row_value.get_object() {
            // object ->
            //  - if "properties" arg was provided: iterate the already-created
            //    columns (except for the 0th which is the index)
            //  - otherwise: iterate the object properties, and create the
            //    columns on-demand
            if !self.properties.is_undefined() {
                for column in columns[1..].iter_mut() {
                    if let Some(value) = row_value.get_own(self.global_object, &column.name)? {
                        column.width = column.width.max(self.get_width_for_value(value)?);
                    }
                }
            } else {
                let mut cols_iter = jsc::JSPropertyIterator::init(
                    self.global_object,
                    obj,
                    jsc::PropertyIteratorOptions { skip_empty_name: false, include_value: true },
                )?;

                while let Some(col_key) = cols_iter.next()? {
                    let value = cols_iter.value;

                    // find or create the column for the property
                    let column: &mut Column = 'brk: {
                        let col_str = BunString::init(col_key);

                        // PORT NOTE: reshaped for borrowck — split find/append.
                        if let Some(idx) = columns[1..]
                            .iter()
                            .position(|col| col.name.eql(&col_str))
                        {
                            break 'brk &mut columns[1 + idx];
                        }

                        // Need to ref this string because JSPropertyIterator
                        // uses `toString` instead of `toStringRef` for property
                        // names.
                        col_str.ref_();

                        columns.push(Column { name: col_str, width: 1 });
                        let last = columns.len() - 1;
                        break 'brk &mut columns[last];
                    };

                    column.width = column.width.max(self.get_width_for_value(value)?);
                }
            }
        } else if self.properties.is_undefined() {
            // not object -> the value will go to the special "Values" column
            self.values_col_width =
                Some(self.values_col_width.unwrap_or(1).max(self.get_width_for_value(row_value)?));
        }
        Ok(())
    }

    fn write_string_n_times(
        writer: &mut dyn bun_io::Write,
        s: &'static [u8],
        n: usize,
    ) -> bun_io::Result<()> {
        if s.len() == 1 {
            return writer.splat_byte_all(s[0], n);
        }
        for _ in 0..n {
            writer.write_all(s)?;
        }
        Ok(())
    }

    fn print_row<const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut dyn bun_io::Write,
        columns: &mut Vec<Column>,
        row_key: RowKey,
        row_value: JSValue,
    ) -> JsResult<()> {
        writer.write_all("│".as_bytes()).ok();
        {
            let len: u32 = match &row_key {
                RowKey::Str(value) => value.visible_width_exclude_ansi_colors(false) as u32,
                RowKey::Num(value) => bun_core::fmt::fast_digit_count(u64::from(*value)) as u32,
            };
            let needed = columns[0].width.saturating_sub(len);

            // Right-align the number column
            writer.splat_byte_all(b' ', (needed + PADDING) as usize).ok();
            match &row_key {
                RowKey::Str(value) => {
                    write!(writer, "{value}").ok();
                }
                RowKey::Num(value) => {
                    write!(writer, "{value}").ok();
                }
            }
            writer.splat_byte_all(b' ', PADDING as usize).ok();
        }

        for col_idx in 1..columns.len() {
            let col = &columns[col_idx];

            writer.write_all("│".as_bytes()).ok();

            let mut value = JSValue::ZERO;
            if col_idx == 1 && self.jstype.is_map() {
                // is the "Keys" column, when iterating a Map?
                value = row_value.get_index(self.global_object, 0)?;
            } else if col_idx == self.values_col_idx {
                // is the "Values" column?
                if self.jstype.is_map() {
                    value = row_value.get_index(self.global_object, 1)?;
                } else if !row_value.is_object() {
                    value = row_value;
                }
            } else if row_value.is_object() {
                value = row_value
                    .get_own(self.global_object, &col.name)?
                    .unwrap_or(JSValue::ZERO);
            }

            if value.is_empty() {
                writer
                    .splat_byte_all(b' ', (col.width + PADDING * 2) as usize)
                    .ok();
            } else {
                let len: u32 = self.get_width_for_value(value)?;
                let needed = col.width.saturating_sub(len);
                writer.splat_byte_all(b' ', PADDING as usize).ok();
                let tag = formatter::Tag::get(value, self.global_object)?;
                let mut value_formatter = self.value_formatter.shallow_clone();

                value_formatter.quote_strings =
                    !(matches!(tag.tag, TagPayload::String | TagPayload::StringPossiblyFormatted));

                // `defer` block: release pooled visit map after formatting.
                let release = scopeguard::guard(&mut self.value_formatter, |vf| {
                    if let Some(node) = value_formatter.map_node.take() {
                        vf.map_node = None;
                        if node.data.capacity() > 512 {
                            node.data.clear_and_free();
                        } else {
                            node.data.clear();
                        }
                        node.release();
                    }
                });
                value_formatter
                    .format::<ENABLE_ANSI_COLORS>(tag, writer, value, self.global_object)?;
                drop(release);

                writer
                    .splat_byte_all(b' ', (needed + PADDING) as usize)
                    .ok();
            }
        }
        writer.write_all("│\n".as_bytes()).ok();
        Ok(())
    }

    pub fn print_table<const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut dyn bun_io::Write,
    ) -> JsResult<()> {
        let global_object = self.global_object;

        // PERF(port): was stack-fallback alloc (16 columns) — profile in Phase B.
        let mut columns: Vec<Column> = Vec::with_capacity(16);
        let _deref_names = scopeguard::guard(&mut columns, |cols| {
            for col in cols.iter_mut() {
                col.name.deref_();
            }
        });
        // PORT NOTE: reshaped for borrowck — re-borrow through the guard.
        let columns: &mut Vec<Column> = &mut **_deref_names;

        // create the first column " " which is always present
        columns.push(Column { name: BunString::static_("\u{0020}"), width: 1 });
        // PERF(port): was assume_capacity

        // special case for Map: create the special "Key" column at index 1
        if self.jstype.is_map() {
            columns.push(Column { name: BunString::static_("Key"), width: 1 });
        }

        // if the "properties" arg was provided, pre-populate the columns
        if !self.properties.is_undefined() {
            let mut properties_iter = jsc::JSArrayIterator::init(self.properties, global_object)?;
            while let Some(value) = properties_iter.next()? {
                columns.push(Column { name: value.to_bun_string(global_object)?, width: 1 });
            }
        }

        // rows first pass - calculate the column widths
        {
            if self.is_iterable {
                struct Ctx<'c, 'a> {
                    this: &'c mut TablePrinter<'a>,
                    columns: &'c mut Vec<Column>,
                    idx: u32,
                    err: bool,
                }
                let mut ctx = Ctx { this: self, columns, idx: 0, err: false };
                extern "C" fn callback(
                    _: *mut jsc::VM,
                    _: &JSGlobalObject,
                    ctx: *mut c_void,
                    value: JSValue,
                ) {
                    // SAFETY: ctx points to the stack `Ctx` above.
                    let ctx = unsafe { &mut *(ctx as *mut Ctx<'_, '_>) };
                    if ctx
                        .this
                        .update_columns_for_row(ctx.columns, RowKey::Num(ctx.idx), value)
                        .is_err()
                    {
                        ctx.err = true;
                    }
                    ctx.idx += 1;
                }
                self.tabular_data
                    .for_each_with_context(global_object, &mut ctx as *mut _ as *mut c_void, callback)?;
                if ctx.err {
                    return Err(jsc::JsError::Thrown);
                }
            } else {
                let tabular_obj = self.tabular_data.to_object(global_object)?;
                let mut rows_iter = jsc::JSPropertyIterator::init(
                    global_object,
                    tabular_obj,
                    jsc::PropertyIteratorOptions { skip_empty_name: false, include_value: true },
                )?;

                while let Some(row_key) = rows_iter.next()? {
                    self.update_columns_for_row(
                        columns,
                        RowKey::Str(BunString::init(row_key)),
                        rows_iter.value,
                    )?;
                }
            }
        }

        // append the special "Values" column as the last one, if it is present
        if let Some(width) = self.values_col_width {
            self.values_col_idx = columns.len();
            columns.push(Column { name: BunString::static_("Values"), width });
        }

        // print the table header (border line + column names line + border line)
        {
            for col in columns.iter_mut() {
                // also update the col width with the length of the column name itself
                col.width = col
                    .width
                    .max(u32::try_from(col.name.visible_width_exclude_ansi_colors(false)).unwrap());
            }

            writer.write_all("┌".as_bytes()).ok();
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    writer.write_all("┬".as_bytes()).ok();
                }
                Self::write_string_n_times(writer, "─".as_bytes(), (col.width + PADDING * 2) as usize).ok();
            }

            writer.write_all("┐\n│".as_bytes()).ok();

            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    writer.write_all("│".as_bytes()).ok();
                }
                let len = col.name.visible_width_exclude_ansi_colors(false);
                let needed = (col.width as usize).saturating_sub(len);
                writer.splat_byte_all(b' ', 1).ok();
                if ENABLE_ANSI_COLORS {
                    writer.write_all(pfmt!("<r><b>", true).as_bytes()).ok();
                }
                write!(writer, "{}", col.name).ok();
                if ENABLE_ANSI_COLORS {
                    writer.write_all(pfmt!("<r>", true).as_bytes()).ok();
                }
                writer.splat_byte_all(b' ', needed + PADDING as usize).ok();
            }

            writer.write_all("│\n├".as_bytes()).ok();
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    writer.write_all("┼".as_bytes()).ok();
                }
                Self::write_string_n_times(writer, "─".as_bytes(), (col.width + PADDING * 2) as usize).ok();
            }
            writer.write_all("┤\n".as_bytes()).ok();
        }

        // rows second pass - print the actual table rows
        {
            if self.is_iterable {
                struct Ctx<'c, 'a> {
                    this: &'c mut TablePrinter<'a>,
                    columns: &'c mut Vec<Column>,
                    writer: &'c mut dyn bun_io::Write,
                    idx: u32,
                    err: bool,
                }
                let mut ctx = Ctx { this: self, columns, writer, idx: 0, err: false };
                extern "C" fn callback<const C: bool>(
                    _: *mut jsc::VM,
                    _: &JSGlobalObject,
                    ctx: *mut c_void,
                    value: JSValue,
                ) {
                    // SAFETY: ctx points to the stack `Ctx` above.
                    let ctx = unsafe { &mut *(ctx as *mut Ctx<'_, '_>) };
                    if ctx
                        .this
                        .print_row::<C>(ctx.writer, ctx.columns, RowKey::Num(ctx.idx), value)
                        .is_err()
                    {
                        ctx.err = true;
                    }
                    ctx.idx += 1;
                }
                self.tabular_data.for_each_with_context(
                    global_object,
                    &mut ctx as *mut _ as *mut c_void,
                    callback::<ENABLE_ANSI_COLORS>,
                )?;
                if ctx.err {
                    return Err(jsc::JsError::Thrown);
                }
            } else {
                let Some(cell) = self.tabular_data.to_cell() else {
                    return Err(global_object
                        .throw_type_error("tabular_data must be an object or array"));
                };
                let mut rows_iter = jsc::JSPropertyIterator::init(
                    global_object,
                    // SAFETY: `to_cell()` returned `Some` above; pointer is a live JSC heap cell.
                    unsafe { &*cell }.to_object(global_object),
                    jsc::PropertyIteratorOptions { skip_empty_name: false, include_value: true },
                )?;

                while let Some(row_key) = rows_iter.next()? {
                    self.print_row::<ENABLE_ANSI_COLORS>(
                        writer,
                        columns,
                        RowKey::Str(BunString::init(row_key)),
                        rows_iter.value,
                    )?;
                }
            }
        }

        // print the table bottom border
        {
            writer.write_all("└".as_bytes()).ok();
            Self::write_string_n_times(
                writer,
                "─".as_bytes(),
                (columns[0].width + PADDING * 2) as usize,
            )
            .ok();
            for column in columns[1..].iter() {
                writer.write_all("┴".as_bytes()).ok();
                Self::write_string_n_times(
                    writer,
                    "─".as_bytes(),
                    (column.width + PADDING * 2) as usize,
                )
                .ok();
            }
            writer.write_all("┘\n".as_bytes()).ok();
        }

        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// writeTrace
// ───────────────────────────────────────────────────────────────────────────

pub fn write_trace(_writer: &mut (impl bun_io::Write + ?Sized), _global: &JSGlobalObject) {
    // TODO(phase-d): body re-gated — `VirtualMachine::print_stack_trace` takes a
    // concrete `bun_core::io::Writer` (not the generic `bun_io::Write` we receive
    // here), and `remap_zig_exception`'s slice parameter is still typed against
    // the unported `ZigString::Slice` path. `console.trace()` falls through to a
    // no-op until those signatures settle.
    todo!("blocked_on: VirtualMachine::print_stack_trace writer type / remap_zig_exception slice param");
}

// ───────────────────────────────────────────────────────────────────────────
// FormatOptions
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct FormatOptions {
    pub enable_colors: bool,
    pub add_newline: bool,
    pub flush: bool,
    pub ordered_properties: bool,
    pub quote_strings: bool,
    pub max_depth: u16,
    pub single_line: bool,
    pub default_indent: u16,
    pub error_display_level: ErrorDisplayLevel,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self {
            enable_colors: false,
            add_newline: false,
            flush: false,
            ordered_properties: false,
            quote_strings: false,
            max_depth: 2,
            single_line: false,
            default_indent: 0,
            error_display_level: ErrorDisplayLevel::Full,
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ErrorDisplayLevel {
    Normal,
    Warn,
    Full,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum Colon {
    IncludeColon,
    ExcludeColon,
}

pub struct ErrorDisplayLevelFormatter {
    pub name: BunString,
    pub level: ErrorDisplayLevel,
    pub enable_colors: bool,
    pub colon: Colon,
}

impl core::fmt::Display for ErrorDisplayLevelFormatter {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.enable_colors {
            match self.level {
                ErrorDisplayLevel::Normal => writer.write_str(pfmt!("<r>", true))?,
                ErrorDisplayLevel::Warn => {
                    writer.write_str(pfmt!("<r><yellow>", true))?
                }
                ErrorDisplayLevel::Full => {
                    writer.write_str(pfmt!("<r><red>", true))?
                }
            }
        }

        if !self.name.is_empty() {
            core::fmt::Display::fmt(&self.name, writer)?;
        } else if self.level == ErrorDisplayLevel::Warn {
            writer.write_str("warn")?;
        } else {
            writer.write_str("error")?;
        }

        if self.colon == Colon::ExcludeColon {
            if self.enable_colors {
                writer.write_str(pfmt!("<r>", true))?;
            }
            return Ok(());
        }

        if self.enable_colors {
            writer.write_str(pfmt!("<r><d>:<r> ", true))?;
        } else {
            writer.write_str(": ")?;
        }
        Ok(())
    }
}

impl ErrorDisplayLevel {
    pub fn formatter(
        self,
        error_name: BunString,
        enable_colors: bool,
        colon: Colon,
    ) -> ErrorDisplayLevelFormatter {
        ErrorDisplayLevelFormatter { name: error_name, level: self, enable_colors, colon }
    }
}

impl FormatOptions {
    pub fn from_js(
        &mut self,
        global_this: &JSGlobalObject,
        arguments: &[JSValue],
    ) -> JsResult<()> {
        let arg1 = arguments[0];

        if arg1.is_object() {
            if let Some(opt) = arg1.get_truthy(global_this, "depth")? {
                if opt.is_int32() {
                    let arg = opt.to_int32();
                    if arg < 0 {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "expected depth to be greater than or equal to 0, got {arg}"
                        )));
                    }
                    self.max_depth = u32::try_from(arg.min(i32::from(u16::MAX))).unwrap() as u16;
                } else if opt.is_number() {
                    let v = opt.coerce_f64(global_this)?;
                    if v.is_infinite() {
                        self.max_depth = u16::MAX;
                    } else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "expected depth to be an integer, got {v}"
                        )));
                    }
                }
            }
            if let Some(opt) = arg1.get_boolean_loose(global_this, "colors")? {
                self.enable_colors = opt;
            }
            if let Some(opt) = arg1.get_boolean_loose(global_this, "sorted")? {
                self.ordered_properties = opt;
            }
            if let Some(opt) = arg1.get_boolean_loose(global_this, "compact")? {
                self.single_line = opt;
            }
        } else {
            // formatOptions.show_hidden = arg1.toBoolean();
            if !arguments.is_empty() {
                let depth_arg = arg1;
                if depth_arg.is_int32() {
                    let arg = depth_arg.to_int32();
                    if arg < 0 {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "expected depth to be greater than or equal to 0, got {arg}"
                        )));
                    }
                    self.max_depth = u32::try_from(arg.min(i32::from(u16::MAX))).unwrap() as u16;
                } else if depth_arg.is_number() {
                    let v = depth_arg.coerce_f64(global_this)?;
                    if v.is_infinite() {
                        self.max_depth = u16::MAX;
                    } else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "expected depth to be an integer, got {v}"
                        )));
                    }
                }
                if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
                    self.enable_colors = arguments[1].to_boolean();
                }
            }
        }
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// format2
// ───────────────────────────────────────────────────────────────────────────

pub fn format2(
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
    writer: &mut dyn bun_io::Write,
    options: FormatOptions,
) -> JsResult<()> {
    // SAFETY: caller guarantees `vals` points at `len` valid JSValues on the
    // stack (conservative GC scan covers them).
    let vals = unsafe { core::slice::from_raw_parts(vals, len) };

    if len == 1 {
        // initialized later in this function.
        // PORT NOTE: `Formatter` has a `Drop` impl, so struct-update from a
        // temporary is rejected (E0509). Construct via `new()` then mutate.
        let mut fmt = Formatter::new(global);
        fmt.ordered_properties = options.ordered_properties;
        fmt.quote_strings = options.quote_strings;
        fmt.max_depth = options.max_depth;
        fmt.single_line = options.single_line;
        fmt.indent = u32::from(options.default_indent);
        fmt.stack_check = StackCheck::init();
        fmt.can_throw_stack_overflow = true;
        fmt.error_display_level = options.error_display_level;
        let tag = formatter::Tag::get(vals[0], global)?;
        if fmt.write_indent(writer).is_err() {
            return Ok(());
        }

        if matches!(tag.tag, TagPayload::String) {
            if options.enable_colors {
                if level == MessageLevel::Error {
                    let _ = writer.write_all(pfmt!("<r><red>", true).as_bytes());
                }
                fmt.format::<true>(tag, writer, vals[0], global)?;
                if level == MessageLevel::Error {
                    let _ = writer.write_all(pfmt!("<r>", true).as_bytes());
                }
            } else {
                fmt.format::<false>(tag, writer, vals[0], global)?;
            }
            if options.add_newline {
                let _ = writer.write_all(b"\n");
            }

            let _ = writer.flush();
        } else {
            // PORT NOTE: Zig `defer if (options.flush) writer.flush()`. Capture
            // a raw pointer so the body can keep a unique `&mut *writer`.
            let writer_ptr: *mut dyn bun_io::Write = writer;
            let _flush = scopeguard::guard((), move |_| {
                if options.flush {
                    // SAFETY: `writer` outlives `_flush`; no other borrow is
                    // live at the guard's drop point (end of this `else`).
                    let _ = unsafe { (*writer_ptr).flush() };
                }
            });
            if options.enable_colors {
                fmt.format::<true>(tag, writer, vals[0], global)?;
            } else {
                fmt.format::<false>(tag, writer, vals[0], global)?;
            }
            if options.add_newline {
                let _ = writer.write_all(b"\n");
            }
        }

        return Ok(());
    }

    // PORT NOTE: Zig `defer if (options.flush) writer.flush()` — raw-ptr in the
    // closure to avoid holding a unique borrow across the body (E0501).
    let writer_ptr: *mut dyn bun_io::Write = writer;
    let _flush = scopeguard::guard((), move |_| {
        if options.flush {
            // SAFETY: `writer` outlives `_flush`; only re-borrowed at drop.
            let _ = unsafe { (*writer_ptr).flush() };
        }
    });

    let mut this_value: JSValue = vals[0];
    // PORT NOTE: see E0509 note above.
    let mut fmt = Formatter::new(global);
    fmt.remaining_values = &vals[1..];
    fmt.ordered_properties = options.ordered_properties;
    fmt.quote_strings = options.quote_strings;
    fmt.max_depth = options.max_depth;
    fmt.single_line = options.single_line;
    fmt.indent = u32::from(options.default_indent);
    fmt.stack_check = StackCheck::init();
    fmt.can_throw_stack_overflow = true;
    fmt.error_display_level = options.error_display_level;
    let mut tag: formatter::TagResult;

    if fmt.write_indent(writer).is_err() {
        return Ok(());
    }

    let mut any = false;
    if options.enable_colors {
        if level == MessageLevel::Error {
            let _ = writer.write_all(pfmt!("<r><red>", true).as_bytes());
        }
        loop {
            if any {
                let _ = writer.write_all(b" ");
            }
            any = true;

            tag = formatter::Tag::get(this_value, global)?;
            if matches!(tag.tag, TagPayload::String) && !fmt.remaining().is_empty() {
                tag.tag = TagPayload::StringPossiblyFormatted;
            }

            fmt.format::<true>(tag, writer, this_value, global)?;
            if fmt.remaining().is_empty() {
                break;
            }

            this_value = fmt.remaining()[0];
            fmt.advance_remaining();
        }
        if level == MessageLevel::Error {
            let _ = writer.write_all(pfmt!("<r>", true).as_bytes());
        }
    } else {
        loop {
            if any {
                let _ = writer.write_all(b" ");
            }
            any = true;
            tag = formatter::Tag::get(this_value, global)?;
            if matches!(tag.tag, TagPayload::String) && !fmt.remaining().is_empty() {
                tag.tag = TagPayload::StringPossiblyFormatted;
            }

            fmt.format::<false>(tag, writer, this_value, global)?;
            if fmt.remaining().is_empty() {
                break;
            }

            this_value = fmt.remaining()[0];
            fmt.advance_remaining();
        }
    }

    if options.add_newline {
        let _ = writer.write_all(b"\n");
    }
    Ok(())
}

#[derive(Clone, Copy, Default)]
pub struct CustomFormattedObject {
    function: JSValue,
    this: JSValue,
}

// ───────────────────────────────────────────────────────────────────────────
// Formatter
// ───────────────────────────────────────────────────────────────────────────

pub use formatter::{Formatter, Tag, TagPayload};

pub mod formatter {
    use super::*;

    /// Mirror Zig's `defer this.field = prev;` without holding a live borrow
    /// on `self` for the body of the scope. Zig `defer` reads at scope-exit
    /// time and never aliases, so we capture a raw `*mut` to the field and
    /// write through it on drop. This lets the body freely take `&mut self`.
    #[allow(unused_macros)] // only used by gated `print_as` body
    macro_rules! defer_restore {
        ($place:expr, $prev:expr) => {{
            let __p: *mut _ = core::ptr::addr_of_mut!($place);
            let __prev = $prev;
            scopeguard::guard((), move |_| unsafe { *__p = __prev; })
        }};
    }

    /// Mirror Zig's `defer this.field -|= 1;` without holding a live borrow.
    #[allow(unused_macros)] // only used by gated `print_as` body
    macro_rules! defer_decrement {
        ($place:expr) => {{
            let __p: *mut _ = core::ptr::addr_of_mut!($place);
            scopeguard::guard((), move |_| unsafe { *__p = (*__p).saturating_sub(1); })
        }};
    }

    pub struct Formatter<'a> {
        pub global_this: &'a JSGlobalObject,

        /// Raw pointer because callers seat this to a stack slice and reset it
        /// to `&[]` before the backing storage goes away (mirrors the Zig
        /// `defer self.formatter.remaining_values = &.{}` pattern). A `&'a`
        /// slice cannot express that without forcing `'a` to outlive locals.
        pub remaining_values: *const [JSValue],
        pub map: visited::Map,
        pub map_node: Option<Box<visited::PoolNode>>,
        pub hide_native: bool,
        pub indent: u32,
        pub depth: u16,
        pub max_depth: u16,
        pub quote_strings: bool,
        pub quote_keys: bool,
        pub failed: bool,
        pub estimated_line_length: usize,
        pub always_newline_scope: bool,
        pub single_line: bool,
        pub ordered_properties: bool,
        pub custom_formatted_object: CustomFormattedObject,
        pub disable_inspect_custom: bool,
        pub stack_check: StackCheck,
        pub can_throw_stack_overflow: bool,
        pub error_display_level: ErrorDisplayLevel,
        /// If `ArrayBuffer`-like objects contain ASCII text, the buffer is
        /// printed as a string. Set true in the error printer so that
        /// `ShellError` prints a more readable message.
        pub format_buffer_as_text: bool,
    }

    impl<'a> Formatter<'a> {
        /// Field-default constructor (Zig struct field defaults).
        pub fn new(global_this: &'a JSGlobalObject) -> Self {
            Self {
                global_this,
                remaining_values: &[],
                map: visited::Map::default(),
                map_node: None,
                hide_native: false,
                indent: 0,
                depth: 0,
                max_depth: 8,
                quote_strings: false,
                quote_keys: false,
                failed: false,
                estimated_line_length: 0,
                always_newline_scope: false,
                single_line: false,
                ordered_properties: false,
                custom_formatted_object: CustomFormattedObject::default(),
                disable_inspect_custom: false,
                stack_check: StackCheck::init(),
                can_throw_stack_overflow: false,
                error_display_level: ErrorDisplayLevel::Full,
                format_buffer_as_text: false,
            }
        }

        /// Zig copies `Formatter` by value (`var f = this.value_formatter;`).
        /// In Rust `Formatter` has a `Drop` impl and owns `map`/`map_node`,
        /// so a bit-copy via `ptr::read` would double-free. The Zig copy
        /// only ever ships scalar config — `map`/`map_node` are always empty
        /// on the source at the call sites — so we copy those fields
        /// explicitly and leave `map`/`map_node` fresh on the clone.
        pub(super) fn shallow_clone(&self) -> Self {
            debug_assert!(
                self.map_node.is_none(),
                "shallow_clone source must not own a visited map"
            );
            Self {
                global_this: self.global_this,
                remaining_values: self.remaining_values,
                map: visited::Map::default(),
                map_node: None,
                hide_native: self.hide_native,
                indent: self.indent,
                depth: self.depth,
                max_depth: self.max_depth,
                quote_strings: self.quote_strings,
                quote_keys: self.quote_keys,
                failed: self.failed,
                estimated_line_length: self.estimated_line_length,
                always_newline_scope: self.always_newline_scope,
                single_line: self.single_line,
                ordered_properties: self.ordered_properties,
                custom_formatted_object: self.custom_formatted_object,
                disable_inspect_custom: self.disable_inspect_custom,
                stack_check: self.stack_check,
                can_throw_stack_overflow: self.can_throw_stack_overflow,
                error_display_level: self.error_display_level,
                format_buffer_as_text: self.format_buffer_as_text,
            }
        }

        /// View the queued `%`-format arguments as a slice.
        ///
        /// SAFETY: callers always seat `remaining_values` to a slice that
        /// outlives the dereference site and reset it to `&[]` before the
        /// backing storage is released.
        #[inline]
        pub fn remaining(&self) -> &[JSValue] {
            unsafe { &*self.remaining_values }
        }

        /// Drop the first queued `%`-format argument.
        #[inline]
        pub fn advance_remaining(&mut self) {
            unsafe {
                let s = &*self.remaining_values;
                self.remaining_values = &s[1..];
            }
        }
    }

    impl Drop for Formatter<'_> {
        fn drop(&mut self) {
            if let Some(mut node) = self.map_node.take() {
                let mut map = core::mem::take(&mut self.map);
                if map.capacity() > 512 {
                    map.deinit();
                } else {
                    map.clear();
                }
                node.data = core::mem::MaybeUninit::new(map);
                // TODO(phase-c): `Node::release()` is a pool method gated on
                // `ObjectPool` storage wiring; until `visited::Pool` un-gates,
                // just drop the boxed node here.
                let _ = node;
            }
        }
    }

    impl Formatter<'_> {
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

    /// `Display` adapter equivalent to Zig's `Formatter.ZigFormatter`.
    ///
    /// The Zig spec (`ConsoleObject.zig:1044-1062`) takes `self: ZigFormatter`
    /// *by value* with a raw `*Formatter` field, so writing through
    /// `self.formatter.*` carries no aliasing constraint. `Display::fmt` only
    /// gives us `&self`, so the mutable handle is parked behind a `Cell` and
    /// moved out for the duration of the call — this preserves unique-borrow
    /// provenance without the `&shared → *const → *mut` cast that would be UB
    /// under Stacked Borrows.
    pub struct ZigFormatter<'a, 'b> {
        pub formatter: Cell<Option<&'a mut Formatter<'b>>>,
        pub value: JSValue,
    }

    impl<'a, 'b> ZigFormatter<'a, 'b> {
        pub fn new(formatter: &'a mut Formatter<'b>, value: JSValue) -> Self {
            Self { formatter: Cell::new(Some(formatter)), value }
        }
    }

    impl core::fmt::Display for ZigFormatter<'_, '_> {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            // TODO(port): Zig writes through `*std.Io.Writer`; here we go
            // through `core::fmt::Write`. Phase B may need a `bun_io::Write`
            // adapter for `core::fmt::Formatter` to keep the byte path.
            //
            // Move the unique `&mut Formatter` out of the cell for the body;
            // re-seat it (and clear `remaining_values`) on the way out so the
            // adapter mirrors Zig's `defer` and stays reusable.
            let formatter: &mut Formatter<'_> = self
                .formatter
                .take()
                .expect("ZigFormatter::fmt re-entered or used after consumption");

            let one = [self.value];
            formatter.remaining_values = &one;

            let result = (|| {
                let tag = Tag::get(self.value, formatter.global_this)
                    .map_err(|_| core::fmt::Error)?;
                // TODO(port): need a `&mut dyn bun_io::Write` over `f`.
                let mut sink = bun_io::FmtAdapter::new(f);
                let global = formatter.global_this;
                formatter
                    .format::<false>(tag, &mut sink, self.value, global)
                    .map_err(|_| core::fmt::Error)
            })();

            // Mirrors Zig `defer self.formatter.remaining_values = &.{}`.
            formatter.remaining_values = &[];
            self.formatter.set(Some(formatter));
            result
        }
    }

    /// For detecting circular references.
    pub mod visited {
        use super::*;
        use bun_collections::pool::ObjectPool;

        pub type Map = bun_collections::HashMap<JSValue, ()>;
        // TODO(port): Zig parameterizes `ObjectPool` with an `init` fn,
        // `threadsafe = true`, and `max_count = 16`. The Rust `ObjectPool`
        // requires `T: ObjectPoolType` plus a per-monomorphization storage
        // hook (see `object_pool!`); `Map` is a foreign type so we can't
        // implement the trait here without a newtype. The only live user of
        // the pool itself is the gated `print_as` body — keep `Pool` gated
        // and name `PoolNode` directly so `Formatter::map_node` /
        // `Drop` still type-check.
        
        pub type Pool = ObjectPool<Map, true, 16>;
        #[allow(unused_imports)] use ObjectPool as _;
        pub type PoolNode = bun_collections::pool::Node<Map>;
    }

    // ───────────────────────────────────────────────────────────────────────
    // Tag
    // ───────────────────────────────────────────────────────────────────────

    #[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr, core::marker::ConstParamTy)]
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
        MapIterator,
        SetIterator,
        Set,
        BigInt,
        Symbol,

        CustomFormattedObject,

        GlobalObject,
        Private,
        Promise,

        JSON,
        ToJSON,
        NativeCode,

        JSX,
        Event,

        GetterSetter,
        CustomGetterSetter,

        Proxy,
        RevokedProxy,
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

        pub fn can_have_circular_references(self) -> bool {
            matches!(
                self,
                Tag::Function
                    | Tag::Array
                    | Tag::Object
                    | Tag::Map
                    | Tag::Set
                    | Tag::Error
                    | Tag::Class
                    | Tag::Event
            )
        }
    }

    /// Zig: `union(Tag)`. Only `CustomFormattedObject` carries a payload.
    #[derive(Copy, Clone)]
    pub enum TagPayload {
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
        MapIterator,
        SetIterator,
        Set,
        BigInt,
        Symbol,
        CustomFormattedObject(CustomFormattedObject),
        GlobalObject,
        Private,
        Promise,
        JSON,
        ToJSON,
        NativeCode,
        JSX,
        Event,
        GetterSetter,
        CustomGetterSetter,
        Proxy,
        RevokedProxy,
    }

    impl TagPayload {
        pub fn is_primitive(self) -> bool {
            self.tag().is_primitive()
        }
        pub fn tag(self) -> Tag {
            match self {
                TagPayload::StringPossiblyFormatted => Tag::StringPossiblyFormatted,
                TagPayload::String => Tag::String,
                TagPayload::Undefined => Tag::Undefined,
                TagPayload::Double => Tag::Double,
                TagPayload::Integer => Tag::Integer,
                TagPayload::Null => Tag::Null,
                TagPayload::Boolean => Tag::Boolean,
                TagPayload::Array => Tag::Array,
                TagPayload::Object => Tag::Object,
                TagPayload::Function => Tag::Function,
                TagPayload::Class => Tag::Class,
                TagPayload::Error => Tag::Error,
                TagPayload::TypedArray => Tag::TypedArray,
                TagPayload::Map => Tag::Map,
                TagPayload::MapIterator => Tag::MapIterator,
                TagPayload::SetIterator => Tag::SetIterator,
                TagPayload::Set => Tag::Set,
                TagPayload::BigInt => Tag::BigInt,
                TagPayload::Symbol => Tag::Symbol,
                TagPayload::CustomFormattedObject(_) => Tag::CustomFormattedObject,
                TagPayload::GlobalObject => Tag::GlobalObject,
                TagPayload::Private => Tag::Private,
                TagPayload::Promise => Tag::Promise,
                TagPayload::JSON => Tag::JSON,
                TagPayload::ToJSON => Tag::ToJSON,
                TagPayload::NativeCode => Tag::NativeCode,
                TagPayload::JSX => Tag::JSX,
                TagPayload::Event => Tag::Event,
                TagPayload::GetterSetter => Tag::GetterSetter,
                TagPayload::CustomGetterSetter => Tag::CustomGetterSetter,
                TagPayload::Proxy => Tag::Proxy,
                TagPayload::RevokedProxy => Tag::RevokedProxy,
            }
        }
    }

    /// Reverse of [`TagPayload::tag`]. The `CustomFormattedObject` arm gets a
    /// default (zero) payload — used by the `ConsoleFormatter` trait bridge in
    /// `lib.rs`, which never passes that tag (write_format hooks pick concrete
    /// tags like `Double` / `Boolean` / `Object` / `Private`).
    impl From<Tag> for TagPayload {
        fn from(t: Tag) -> Self {
            match t {
                Tag::StringPossiblyFormatted => TagPayload::StringPossiblyFormatted,
                Tag::String => TagPayload::String,
                Tag::Undefined => TagPayload::Undefined,
                Tag::Double => TagPayload::Double,
                Tag::Integer => TagPayload::Integer,
                Tag::Null => TagPayload::Null,
                Tag::Boolean => TagPayload::Boolean,
                Tag::Array => TagPayload::Array,
                Tag::Object => TagPayload::Object,
                Tag::Function => TagPayload::Function,
                Tag::Class => TagPayload::Class,
                Tag::Error => TagPayload::Error,
                Tag::TypedArray => TagPayload::TypedArray,
                Tag::Map => TagPayload::Map,
                Tag::MapIterator => TagPayload::MapIterator,
                Tag::SetIterator => TagPayload::SetIterator,
                Tag::Set => TagPayload::Set,
                Tag::BigInt => TagPayload::BigInt,
                Tag::Symbol => TagPayload::Symbol,
                Tag::CustomFormattedObject => {
                    TagPayload::CustomFormattedObject(CustomFormattedObject::default())
                }
                Tag::GlobalObject => TagPayload::GlobalObject,
                Tag::Private => TagPayload::Private,
                Tag::Promise => TagPayload::Promise,
                Tag::JSON => TagPayload::JSON,
                Tag::ToJSON => TagPayload::ToJSON,
                Tag::NativeCode => TagPayload::NativeCode,
                Tag::JSX => TagPayload::JSX,
                Tag::Event => TagPayload::Event,
                Tag::GetterSetter => TagPayload::GetterSetter,
                Tag::CustomGetterSetter => TagPayload::CustomGetterSetter,
                Tag::Proxy => TagPayload::Proxy,
                Tag::RevokedProxy => TagPayload::RevokedProxy,
            }
        }
    }

    #[derive(Copy, Clone)]
    pub struct TagResult {
        pub tag: TagPayload,
        pub cell: jsc::JSType,
    }

    impl Default for TagResult {
        fn default() -> Self {
            Self { tag: TagPayload::Undefined, cell: jsc::JSType::Cell }
        }
    }

    // It sounds silly to make this packed, but `Tag::get_advanced` is
    // extremely recursive.
    bitflags::bitflags! {
        #[derive(Copy, Clone, Default)]
        pub struct TagOptions: u8 {
            const HIDE_GLOBAL = 1 << 0;
            const DISABLE_INSPECT_CUSTOM = 1 << 1;
        }
    }

    impl Tag {
        pub fn get(value: JSValue, global_this: &JSGlobalObject) -> JsResult<TagResult> {
            Self::get_advanced(value, global_this, TagOptions::empty())
        }

        pub fn get_advanced(
            value: JSValue,
            global_this: &JSGlobalObject,
            opts: TagOptions,
        ) -> JsResult<TagResult> {
            if value.is_empty() || value == JSValue::UNDEFINED {
                return Ok(TagResult { tag: TagPayload::Undefined, ..Default::default() });
            }
            if value == JSValue::NULL {
                return Ok(TagResult { tag: TagPayload::Null, ..Default::default() });
            }

            if value.is_int32() {
                return Ok(TagResult { tag: TagPayload::Integer, ..Default::default() });
            } else if value.is_number() {
                return Ok(TagResult { tag: TagPayload::Double, ..Default::default() });
            } else if value.is_boolean() {
                return Ok(TagResult { tag: TagPayload::Boolean, ..Default::default() });
            }

            if !value.is_cell() {
                return Ok(TagResult { tag: TagPayload::NativeCode, ..Default::default() });
            }

            let js_type = value.js_type();

            if js_type.is_hidden() {
                return Ok(TagResult { tag: TagPayload::NativeCode, cell: js_type });
            }

            if js_type == jsc::JSType::Cell {
                return Ok(TagResult { tag: TagPayload::NativeCode, cell: js_type });
            }

            if js_type.can_get()
                && js_type != jsc::JSType::ProxyObject
                && !opts.contains(TagOptions::DISABLE_INSPECT_CUSTOM)
            {
                // Attempt to get custom formatter
                match value.fast_get(global_this, jsc::BuiltinName::InspectCustom) {
                    Err(_) => {
                        return Ok(TagResult { tag: TagPayload::RevokedProxy, ..Default::default() });
                    }
                    Ok(Some(callback_value)) if callback_value.is_callable() => {
                        return Ok(TagResult {
                            tag: TagPayload::CustomFormattedObject(CustomFormattedObject {
                                function: callback_value,
                                this: value,
                            }),
                            cell: js_type,
                        });
                    }
                    _ => {}
                }
            }

            if js_type == jsc::JSType::DOMWrapper {
                return Ok(TagResult { tag: TagPayload::Private, cell: js_type });
            }

            // If we check an Object has a method table and it does not it will crash
            if js_type != jsc::JSType::Object
                && js_type != jsc::JSType::ProxyObject
                && value.is_callable()
            {
                // TODO(phase-c): `JSValue::is_class` not yet ported.
                
                if value.is_class(global_this) {
                    return Ok(TagResult { tag: TagPayload::Class, cell: js_type });
                }

                // TODO: we print InternalFunction as Object because we have a lot
                // of callable namespaces and printing the contents of it is better
                // than [Function: namespace]. Ideally, we would print
                // `[Function: namespace] { ... }` on all functions, internal and
                // js. What we'll do later is rid of .Function and .Class and
                // handle the prefix in the .Object formatter.
                return Ok(TagResult {
                    tag: if js_type == jsc::JSType::InternalFunction {
                        TagPayload::Object
                    } else {
                        TagPayload::Function
                    },
                    cell: js_type,
                });
            }

            if js_type == jsc::JSType::GlobalProxy {
                // TODO(phase-c): `JSValue::c` / `as_object_ref` /
                // `JSObjectGetProxyTarget` not yet ported — fall through to
                // GlobalObject for now (no recursion into proxy target).
                return Ok(TagResult { tag: TagPayload::GlobalObject, cell: js_type });
            }

            // Is this a react element?
            // TODO(phase-c): `JSValue::get_own_truthy` / `symbol_for` not yet
            // ported — JSX detection re-gated.
            
            if js_type.is_object() && js_type != jsc::JSType::ProxyObject {
                if let Some(typeof_symbol) = value.get_own_truthy(global_this, "$$typeof")? {
                    // React 18 and below
                    let mut react_element_legacy = ZigString::init(b"react.element");
                    // For React 19 - https://github.com/oven-sh/bun/issues/17223
                    let mut react_element_transitional =
                        ZigString::init(b"react.transitional.element");
                    let mut react_fragment = ZigString::init(b"react.fragment");

                    if typeof_symbol
                        .is_same_value(JSValue::symbol_for(global_this, &mut react_element_legacy), global_this)?
                        || typeof_symbol.is_same_value(
                            JSValue::symbol_for(global_this, &mut react_element_transitional),
                            global_this,
                        )?
                        || typeof_symbol
                            .is_same_value(JSValue::symbol_for(global_this, &mut react_fragment), global_this)?
                    {
                        return Ok(TagResult { tag: TagPayload::JSX, cell: js_type });
                    }
                }
            }

            use jsc::JSType as T;
            let tag = match js_type {
                T::ErrorInstance => TagPayload::Error,
                T::NumberObject => TagPayload::Double,
                T::DerivedArray | T::Array | T::DirectArguments | T::ScopedArguments | T::ClonedArguments => {
                    TagPayload::Array
                }
                T::DerivedStringObject | T::String | T::StringObject => TagPayload::String,
                T::RegExpObject => TagPayload::String,
                T::Symbol => TagPayload::Symbol,
                T::BooleanObject => TagPayload::Boolean,
                T::JSFunction => TagPayload::Function,
                T::WeakMap | T::Map => TagPayload::Map,
                T::MapIterator => TagPayload::MapIterator,
                T::SetIterator => TagPayload::SetIterator,
                T::WeakSet | T::Set => TagPayload::Set,
                T::JSDate => TagPayload::JSON,
                T::JSPromise => TagPayload::Promise,

                T::WrapForValidIterator
                | T::RegExpStringIterator
                | T::JSArrayIterator
                | T::Iterator
                | T::IteratorHelper
                | T::Object
                | T::FinalObject
                | T::ModuleNamespaceObject => TagPayload::Object,

                T::ProxyObject => {
                    // TODO(phase-c): `JSValue::get_proxy_internal_field` /
                    // `jsc::ProxyField` not yet ported — assume live proxy.
                    
                    {
                        let handler = value.get_proxy_internal_field(jsc::ProxyField::Handler);
                        if handler.is_empty() || handler.is_undefined_or_null() {
                            return Ok(TagResult { tag: TagPayload::RevokedProxy, cell: js_type });
                        }
                    }
                    TagPayload::Proxy
                }

                T::GlobalObject => {
                    if !opts.contains(TagOptions::HIDE_GLOBAL) {
                        TagPayload::Object
                    } else {
                        TagPayload::GlobalObject
                    }
                }

                T::ArrayBuffer
                | T::Int8Array
                | T::Uint8Array
                | T::Uint8ClampedArray
                | T::Int16Array
                | T::Uint16Array
                | T::Int32Array
                | T::Uint32Array
                | T::Float16Array
                | T::Float32Array
                | T::Float64Array
                | T::BigInt64Array
                | T::BigUint64Array
                | T::DataView => TagPayload::TypedArray,

                T::HeapBigInt => TagPayload::BigInt,

                // None of these should ever exist here
                // But we're going to check anyway
                T::APIValueWrapper
                | T::NativeExecutable
                | T::ProgramExecutable
                | T::ModuleProgramExecutable
                | T::EvalExecutable
                | T::FunctionExecutable
                | T::UnlinkedFunctionExecutable
                | T::UnlinkedProgramCodeBlock
                | T::UnlinkedModuleProgramCodeBlock
                | T::UnlinkedEvalCodeBlock
                | T::UnlinkedFunctionCodeBlock
                | T::CodeBlock
                | T::JSCellButterfly
                | T::JSSourceCode
                | T::JSCallee
                | T::GlobalLexicalEnvironment
                | T::LexicalEnvironment
                | T::ModuleEnvironment
                | T::StrictEvalActivation
                | T::WithScope => TagPayload::NativeCode,

                T::Event => TagPayload::Event,

                T::GetterSetter => TagPayload::GetterSetter,
                T::CustomGetterSetter => TagPayload::CustomGetterSetter,

                T::JSAsJSONType => TagPayload::ToJSON,

                _ => TagPayload::JSON,
            };
            Ok(TagResult { tag, cell: js_type })
        }
    }

    // TODO(phase-c): `jsc::C::CellType` not yet exported; only used by gated
    // `print_as` body, so alias to `JSType` to keep the type name resolvable.
    #[allow(dead_code)]
    type CellType = jsc::JSType;

    thread_local! {
        static NAME_BUF: RefCell<[u8; 512]> = const { RefCell::new([0; 512]) };
    }

    /// <https://console.spec.whatwg.org/#formatter>
    #[derive(Copy, Clone, Eq, PartialEq)]
    enum PercentTag {
        S, // s
        I, // i or d
        F, // f
        O, // o (lowercase)
        UpperO, // O
        C, // c
        J, // j
    }

    // TODO(phase-c): re-gated — `write_with_formatting` body references
    // unported `JSValue`/`ZigString` surface (~5 errs). Restore once the
    // missing methods land.
    
    impl<'a> Formatter<'a> {
        // TODO(port): Zig parameterizes over `Slice` (`[]const u8` or `[]const u16`)
        // via `comptime Slice: type`. Phase A handles only the `&[u8]` path; the
        // UTF-16 path was unused at the call site (`slice` always comes from
        // `toSlice` → UTF-8).
        fn write_with_formatting<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            slice_: &[u8],
            global: &'a JSGlobalObject,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let mut slice = slice_;
            let mut i: u32 = 0;
            let mut len: u32 = slice.len() as u32;
            let mut hit_percent = false;
            'outer: while i < len {
                if hit_percent {
                    i = 0;
                    hit_percent = false;
                }

                match slice[i as usize] {
                    b'%' => {
                        i += 1;
                        if i >= len {
                            break;
                        }

                        // PORT NOTE: borrowck — `writer` holds `&mut self.estimated_line_length`,
                        // so route `remaining_values` reads/writes through the raw-pointer
                        // field directly instead of the `&self` helper methods.
                        if unsafe { (*self.remaining_values).is_empty() } {
                            break;
                        }

                        let token: PercentTag = match slice[i as usize] {
                            b's' => PercentTag::S,
                            b'f' => PercentTag::F,
                            b'o' => PercentTag::O,
                            b'O' => PercentTag::UpperO,
                            b'd' | b'i' => PercentTag::I,
                            b'c' => PercentTag::C,
                            b'j' => PercentTag::J,
                            b'%' => {
                                // print up to and including the first %
                                let end = &slice[0..i as usize];
                                writer.write_all(end);
                                // then skip the second % so we dont hit it again
                                slice = &slice[slice.len().min((i + 1) as usize)..];
                                len = slice.len() as u32;
                                // PORT NOTE: replicates Zig's `while : (i += 1)` continue-
                                // expression — Zig's `i = 0; continue;` is bumped to 1 by
                                // the continue-expr, so the next iteration inspects
                                // `slice[1]`, not `slice[0]`. (This is itself an upstream
                                // off-by-one vs the WHATWG spec; tracked separately.)
                                i = 1;
                                continue;
                            }
                            _ => {
                                i += 1;
                                continue;
                            }
                        };

                        // Flush everything up to the %
                        let end = &slice[0..(i - 1) as usize];
                        writer.write_all(end);
                        slice = &slice[slice.len().min((i + 1) as usize)..];
                        i = 0;
                        hit_percent = true;
                        len = slice.len() as u32;
                        let next_value = unsafe { (*self.remaining_values)[0] };
                        self.remaining_values = unsafe { &(*self.remaining_values)[1..] };

                        // https://console.spec.whatwg.org/#formatter
                        const MAX_BEFORE_E_NOTATION: f64 = 1.0e21;
                        const MIN_BEFORE_E_NOTATION: f64 = 0.000001;
                        match token {
                            PercentTag::S => {
                                // PORT NOTE: reshaped for borrowck — drop `writer` borrow before
                                // recursing into `print_as` which takes `&mut self`.
                                drop(writer);
                                self.print_as::<{ Tag::String }, ENABLE_ANSI_COLORS>(
                                    writer_,
                                    next_value,
                                    next_value.js_type(),
                                )?;
                                writer = WrappedWriter {
                                    ctx: writer_,
                                    failed: false,
                                    estimated_line_length: &mut self.estimated_line_length,
                                };
                            }
                            PercentTag::I => {
                                // 1. If Type(current) is Symbol, let converted be NaN
                                // 2. Otherwise, let converted be the result of
                                //    Call(%parseInt%, undefined, current, 10)
                                let int: i64 = 'brk: {
                                    // This logic is convoluted because %parseInt%
                                    // will coerce the argument to a string first.
                                    // As an optimization, we can check if the
                                    // argument is a number and skip such coercion.
                                    if next_value.is_int32() {
                                        // Already an int, parseInt will parse to itself.
                                        break 'brk i64::from(next_value.as_int32());
                                    }

                                    'double_convert: {
                                        if !(next_value.is_number() || !next_value.is_symbol()) {
                                            break 'double_convert;
                                        }
                                        let mut value = next_value.to_number(global)?;

                                        if !value.is_finite() {
                                            // for NaN and the string Infinity and
                                            // -Infinity, parseInt returns NaN
                                            break 'double_convert;
                                        }

                                        // simulate parseInt, which converts the
                                        // argument to a string and then back to a
                                        // number, without converting it to a string
                                        if value == 0.0 {
                                            break 'brk 0;
                                        }

                                        let sign: i64 = if value < 0.0 { -1 } else { 1 };
                                        value = value.abs();
                                        if value >= MAX_BEFORE_E_NOTATION {
                                            // toString prints 1.000+e0, which parseInt
                                            // will stop at the '.' or the '+', this
                                            // gives us a single digit value.
                                            while value >= 10.0 {
                                                value /= 10.0;
                                            }
                                            break 'brk (value.floor() as i64) * sign;
                                        } else if value < MIN_BEFORE_E_NOTATION {
                                            // toString prints 1.000-e0, which parseInt
                                            // will stop at the '.' or the '-', this
                                            // gives us a single digit value.
                                            while value < 1.0 {
                                                value *= 10.0;
                                            }
                                            break 'brk (value.floor() as i64) * sign;
                                        }

                                        // parsing stops at '.', so this is equal to floor
                                        break 'brk (value.floor() as i64) * sign;
                                    }

                                    // for NaN and the string Infinity and -Infinity,
                                    // parseInt returns NaN
                                    writer.add_for_new_line("NaN".len());
                                    writer.print(format_args!("NaN"));
                                    i += 1;
                                    continue 'outer;
                                };

                                if int < i64::from(u32::MAX) {
                                    let is_negative = int < 0;
                                    let digits = if i != 0 {
                                        bun_core::fmt::fast_digit_count(int.unsigned_abs())
                                            + (is_negative as u64)
                                    } else {
                                        1
                                    };
                                    writer.add_for_new_line(digits as usize);
                                } else {
                                    writer.add_for_new_line(bun_core::fmt::count_int(int));
                                }
                                writer.print(format_args!("{int}"));
                            }

                            PercentTag::F => {
                                // 1. If Type(current) is Symbol, let converted be NaN
                                // 2. Otherwise, let converted be the result of
                                //    Call(%parseFloat%, undefined, [current]).
                                let converted: f64 = 'brk: {
                                    if next_value.is_int32() {
                                        let int = next_value.as_int32();
                                        let is_negative = int < 0;
                                        let digits = if i != 0 {
                                            bun_core::fmt::fast_digit_count(
                                                u64::from(int.unsigned_abs()),
                                            ) + (is_negative as u64)
                                        } else {
                                            1
                                        };
                                        writer.add_for_new_line(digits as usize);
                                        writer.print(format_args!("{int}"));
                                        i += 1;
                                        continue 'outer;
                                    }
                                    if next_value.is_number() {
                                        break 'brk next_value.as_number();
                                    }
                                    if next_value.is_symbol() {
                                        break 'brk f64::NAN;
                                    }
                                    // TODO: this is not perfectly emulating
                                    // parseFloat, because spec says to convert the
                                    // value to a string and then parse as a number,
                                    // but we are just coercing a number.
                                    break 'brk next_value.to_number(global)?;
                                };

                                let abs = converted.abs();
                                if abs < MAX_BEFORE_E_NOTATION && abs >= MIN_BEFORE_E_NOTATION {
                                    writer.add_for_new_line(bun_core::fmt::count_float(converted));
                                    writer.print(format_args!("{converted}"));
                                } else if converted.is_nan() {
                                    writer.add_for_new_line("NaN".len());
                                    writer.write_all(b"NaN");
                                } else if converted.is_infinite() {
                                    writer.add_for_new_line(
                                        "Infinity".len() + ((converted < 0.0) as usize),
                                    );
                                    if converted < 0.0 {
                                        writer.write_all(b"-");
                                    }
                                    writer.write_all(b"Infinity");
                                } else {
                                    let mut buf = [0u8; 124];
                                    let formatted =
                                        bun_core::fmt::FormatDouble::dtoa(&mut buf, converted);
                                    writer.add_for_new_line(formatted.len());
                                    writer.print(format_args!("{}", bstr::BStr::new(formatted)));
                                }
                            }

                            PercentTag::O | PercentTag::UpperO => {
                                if token == PercentTag::O {
                                    // TODO: Node.js applies the following extra formatter options.
                                    //
                                    // this.max_depth = 4;
                                    // this.show_proxy = true;
                                    // this.show_hidden = true;
                                    //
                                    // Spec defines %o as:
                                    // > An object with optimally useful formatting is an
                                    // > implementation-specific, potentially-interactive
                                    // > representation of an object judged to be maximally useful
                                    // > and informative.
                                }
                                drop(writer);
                                self.format::<ENABLE_ANSI_COLORS>(
                                    Tag::get(next_value, global)?,
                                    writer_,
                                    next_value,
                                    global,
                                )?;
                                writer = WrappedWriter {
                                    ctx: writer_,
                                    failed: false,
                                    estimated_line_length: &mut self.estimated_line_length,
                                };
                            }

                            PercentTag::C => {
                                // TODO: Implement %c
                            }

                            PercentTag::J => {
                                // JSON.stringify the value using FastStringifier
                                // for SIMD optimization
                                let mut str = BunString::empty();
                                next_value.json_stringify_fast(global, &mut str)?;
                                writer.add_for_new_line(str.length());
                                writer.print(format_args!("{str}"));
                                str.deref();
                            }
                        }
                        if unsafe { (*self.remaining_values).is_empty() } {
                            break;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }

            if !slice.is_empty() {
                writer.write_all(slice);
            }
            Ok(())
        }
    }

    /// Zig: `fn WrappedWriter(comptime Writer: type) type`. We collapse the
    /// generic over `*std.Io.Writer` into `&mut dyn bun_io::Write`.
    // PERF(port): was comptime monomorphization (`fn WrappedWriter(comptime Writer: type) type`) — profile in Phase B
    pub struct WrappedWriter<'w> {
        pub ctx: &'w mut dyn bun_io::Write,
        pub failed: bool,
        pub estimated_line_length: &'w mut usize,
    }

    // TODO(phase-c): re-gated — body references unported helpers.
    
    impl<'w> WrappedWriter<'w> {
        pub const IS_WRAPPED_WRITER: bool = true;

        /// Mirror of `Formatter::add_for_new_line` routed through the borrowed
        /// `estimated_line_length` so callers don't need a second `&mut self`
        /// on the parent `Formatter` while a `WrappedWriter` is live.
        pub fn add_for_new_line(&mut self, len: usize) {
            *self.estimated_line_length = self.estimated_line_length.saturating_add(len);
        }

        /// Mirror of `Formatter::reset_line` routed through the borrowed
        /// `estimated_line_length`. Takes the current `Formatter::indent` by
        /// value so the caller can pass `self.indent` (a disjoint field
        /// borrow) while this `WrappedWriter` is live.
        pub fn reset_line(&mut self, indent: u32) {
            *self.estimated_line_length = (indent as usize) * 2;
        }

        /// Mirror of `Formatter::good_time_for_a_new_line` routed through the
        /// borrowed `estimated_line_length`.
        pub fn good_time_for_a_new_line(&mut self, indent: u32) -> bool {
            if *self.estimated_line_length > 80 {
                self.reset_line(indent);
                return true;
            }
            false
        }

        /// Mirror of `Formatter::print_comma` routed through the wrapped
        /// `ctx` writer + borrowed `estimated_line_length`.
        pub fn print_comma<const ENABLE_ANSI_COLORS: bool>(&mut self) {
            if self
                .ctx
                .write_all(pfmt!("<r><d>,<r>", ENABLE_ANSI_COLORS).as_bytes())
                .is_err()
            {
                self.failed = true;
            }
            *self.estimated_line_length += 1;
        }

        /// Mirror of `Formatter::write_indent` routed through the wrapped
        /// `ctx` writer. Takes the current `Formatter::indent` by value.
        pub fn write_indent(&mut self, indent: u32) {
            let mut total_remain: u32 = indent;
            while total_remain > 0 {
                let written: u8 = total_remain.min(32) as u8;
                if self
                    .ctx
                    .write_all(&INDENTATION_BUF[0..(written as usize) * 2])
                    .is_err()
                {
                    self.failed = true;
                    return;
                }
                total_remain = total_remain.saturating_sub(u32::from(written));
            }
        }

        pub fn print(&mut self, args: core::fmt::Arguments<'_>) {
            if self.ctx.write_fmt(args).is_err() {
                self.failed = true;
            }
        }

        pub fn space(&mut self) {
            *self.estimated_line_length += 1;
            if self.ctx.write_all(b" ").is_err() {
                self.failed = true;
            }
        }

        // TODO(port): Zig computed `length_ignoring_formatted_values` at
        // comptime by walking the format string. We need a `const fn` /
        // proc-macro to recover that; Phase A takes the count as a runtime
        // argument computed by the `pretty!` macro.
        pub fn pretty<const ENABLE_ANSI_COLOR: bool>(
            &mut self,
            fmt_len: usize,
            args: core::fmt::Arguments<'_>,
        ) {
            *self.estimated_line_length += fmt_len;
            if self.ctx.write_fmt(args).is_err() {
                self.failed = true;
            }
        }

        pub fn write_latin1(&mut self, buf: &[u8]) {
            let mut remain = buf;
            while !remain.is_empty() {
                if let Some(i) = strings::immutable::first_non_ascii(remain) {
                    if i > 0 {
                        if self.ctx.write_all(&remain[0..i as usize]).is_err() {
                            self.failed = true;
                            return;
                        }
                    }
                    if self
                        .ctx
                        .write_all(&strings::immutable::latin1_to_codepoint_bytes_assume_not_ascii(
                            remain[i as usize],
                        ))
                        .is_err()
                    {
                        self.failed = true;
                    }
                    remain = &remain[i as usize + 1..];
                } else {
                    break;
                }
            }

            let _ = self.ctx.write_all(remain);
        }

        #[inline]
        pub fn write_all(&mut self, buf: &[u8]) {
            if self.ctx.write_all(buf).is_err() {
                self.failed = true;
            }
        }

        #[inline]
        pub fn write_string(&mut self, str: &ZigString) {
            self.print(format_args!("{str}"));
        }

        #[inline]
        pub fn write_16_bit(&mut self, input: &[u16]) {
            // `format_utf16_type` requires `impl fmt::Write + Sized`; route through
            // the `Display` adapter so we go via `bun_io::Write::write_fmt` instead.
            self.print(format_args!(
                "{}",
                bun_core::fmt::FormatUTF16 { buf: input, path_fmt_opts: None }
            ));
        }
    }

    const INDENTATION_BUF: [u8; 64] = [b' '; 64];

    /// Free-function indent writer for callsites where a `WrappedWriter`
    /// already holds `&mut self.estimated_line_length`, which would otherwise
    /// conflict with the `&self` borrow `Formatter::write_indent` takes.
    /// `self.indent` is a disjoint field read, so passing it by value here
    /// keeps the borrow checker happy.
    pub(super) fn write_indent_n(
        indent: u32,
        writer: &mut dyn bun_io::Write,
    ) -> bun_io::Result<()> {
        let mut total_remain: u32 = indent;
        while total_remain > 0 {
            let written: u8 = total_remain.min(32) as u8;
            writer.write_all(&INDENTATION_BUF[0..(written as usize) * 2])?;
            total_remain = total_remain.saturating_sub(u32::from(written));
        }
        Ok(())
    }

    impl Formatter<'_> {
        pub fn write_indent(
            &self,
            writer: &mut dyn bun_io::Write,
        ) -> bun_io::Result<()> {
            write_indent_n(self.indent, writer)
        }

        pub fn print_comma<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            writer: &mut dyn bun_io::Write,
        ) -> bun_io::Result<()> {
            writer.write_all(pfmt!("<r><d>,<r>", ENABLE_ANSI_COLORS).as_bytes())?;
            self.estimated_line_length += 1;
            Ok(())
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // MapIterator / SetIterator / PropertyIterator (forEach callback contexts)
    // ───────────────────────────────────────────────────────────────────────

    pub struct MapIteratorCtx<'a, 'b, const C: bool, const IS_ITERATOR: bool, const SINGLE_LINE: bool> {
        pub formatter: &'a mut Formatter<'b>,
        pub writer: &'a mut dyn bun_io::Write,
        pub count: usize,
    }

     // TODO(phase-c): re-gated — calls gated `Formatter::format`.
    impl<'a, 'b, const C: bool, const IS_ITERATOR: bool, const SINGLE_LINE: bool>
        MapIteratorCtx<'a, 'b, C, IS_ITERATOR, SINGLE_LINE>
    {
        pub extern "C" fn for_each(
            _: *mut jsc::VM,
            global_object: &JSGlobalObject,
            ctx: *mut c_void,
            next_value: JSValue,
        ) {
            // SAFETY: ctx points to the stack-allocated `Self` passed by the caller via the C forEach callback.
            let Some(ctx) = (unsafe { (ctx as *mut Self).as_mut() }) else { return };
            let this = ctx;
            if this.formatter.failed {
                return;
            }
            if SINGLE_LINE && this.count > 0 {
                this.formatter.print_comma::<C>(this.writer).expect("unreachable");
                this.writer.write_all(b" ").expect("unreachable");
            }
            if !IS_ITERATOR {
                let Ok(key) = next_value.get_index(global_object, 0) else { return };
                let Ok(value) = next_value.get_index(global_object, 1) else { return };

                if !SINGLE_LINE {
                    this.formatter.write_indent(this.writer).expect("unreachable");
                }
                let mut opts = TagOptions::HIDE_GLOBAL;
                if this.formatter.disable_inspect_custom {
                    opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
                }
                let Ok(key_tag) = Tag::get_advanced(key, global_object, opts) else { return };

                let _ = this.formatter.format::<C>(key_tag, this.writer, key, this.formatter.global_this);
                this.writer.write_all(b": ").expect("unreachable");
                let Ok(value_tag) = Tag::get_advanced(value, global_object, opts) else { return };
                let _ = this.formatter.format::<C>(value_tag, this.writer, value, this.formatter.global_this);
            } else {
                if !SINGLE_LINE {
                    this.writer.write_all(b"\n").expect("unreachable");
                    this.formatter.write_indent(this.writer).expect("unreachable");
                }
                let mut opts = TagOptions::HIDE_GLOBAL;
                if this.formatter.disable_inspect_custom {
                    opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
                }
                let Ok(tag) = Tag::get_advanced(next_value, global_object, opts) else { return };
                let _ = this
                    .formatter
                    .format::<C>(tag, this.writer, next_value, this.formatter.global_this);
            }
            this.count += 1;
            if !SINGLE_LINE {
                this.formatter.print_comma::<C>(this.writer).expect("unreachable");
                if !IS_ITERATOR {
                    this.writer.write_all(b"\n").expect("unreachable");
                }
            }
        }
    }

    pub struct SetIteratorCtx<'a, 'b, const C: bool, const SINGLE_LINE: bool> {
        pub formatter: &'a mut Formatter<'b>,
        pub writer: &'a mut dyn bun_io::Write,
        pub is_first: bool,
    }

     // TODO(phase-c): re-gated — calls gated `Formatter::format`.
    impl<'a, 'b, const C: bool, const SINGLE_LINE: bool> SetIteratorCtx<'a, 'b, C, SINGLE_LINE> {
        pub extern "C" fn for_each(
            _: *mut jsc::VM,
            global_object: &JSGlobalObject,
            ctx: *mut c_void,
            next_value: JSValue,
        ) {
            // SAFETY: ctx points to the stack-allocated `Self` passed by the caller via the C forEach callback.
            let Some(this) = (unsafe { (ctx as *mut Self).as_mut() }) else { return };
            if this.formatter.failed {
                return;
            }
            if SINGLE_LINE {
                if !this.is_first {
                    this.formatter.print_comma::<C>(this.writer).expect("unreachable");
                    this.writer.write_all(b" ").expect("unreachable");
                }
                this.is_first = false;
            } else {
                let _ = this.formatter.write_indent(this.writer);
            }
            let mut opts = TagOptions::HIDE_GLOBAL;
            if this.formatter.disable_inspect_custom {
                opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
            }
            let Ok(key_tag) = Tag::get_advanced(next_value, global_object, opts) else { return };
            let _ = this
                .formatter
                .format::<C>(key_tag, this.writer, next_value, this.formatter.global_this);

            if !SINGLE_LINE {
                this.formatter.print_comma::<C>(this.writer).expect("unreachable");
                this.writer.write_all(b"\n").expect("unreachable");
            }
        }
    }

    pub struct PropertyIteratorCtx<'a, 'b, const C: bool> {
        pub formatter: &'a mut Formatter<'b>,
        pub writer: &'a mut dyn bun_io::Write,
        pub i: usize,
        pub single_line: bool,
        pub always_newline: bool,
        pub parent: JSValue,
    }

     // TODO(phase-c): re-gated — body references unported `JSValue` surface.
    impl<'a, 'b, const C: bool> PropertyIteratorCtx<'a, 'b, C> {
        pub fn handle_first_property(
            &mut self,
            global_this: &JSGlobalObject,
            value: JSValue,
        ) -> JsResult<()> {
            if value.is_cell() && !value.js_type().is_function() {
                let mut writer = WrappedWriter {
                    ctx: self.writer,
                    failed: false,
                    estimated_line_length: &mut self.formatter.estimated_line_length,
                };

                if let Some(name_str) = get_object_name(global_this, value)? {
                    writer.print(format_args!("{name_str} "));
                }
            }

            if !self.single_line {
                self.always_newline = true;
            }
            self.formatter.estimated_line_length = (self.formatter.indent as usize) * 2 + 1;
            self.formatter.indent += 1;
            self.formatter.depth += 1;
            if self.single_line {
                let _ = self.writer.write_all(b"{ ");
            } else {
                let _ = self.writer.write_all(b"{\n");
                let _ = self.formatter.write_indent(self.writer);
            }
            Ok(())
        }

        pub extern "C" fn for_each(
            global_this: &JSGlobalObject,
            ctx_ptr: *mut c_void,
            key: *mut ZigString,
            value: JSValue,
            is_symbol: bool,
            is_private_symbol: bool,
        ) {
            // SAFETY: caller passes a valid `*ZigString`.
            let key = unsafe { &*key };
            if key.eql_comptime(b"constructor") {
                return;
            }

            // SAFETY: ctx_ptr points to the stack-allocated `Self` passed by the caller via the C forEach callback.
            let Some(ctx) = (unsafe { (ctx_ptr as *mut Self).as_mut() }) else { return };
            let this = &mut *ctx.formatter;
            if this.failed {
                return;
            }
            let writer_ = &mut *ctx.writer;
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut this.estimated_line_length,
            };

            let mut opts = TagOptions::HIDE_GLOBAL;
            if this.disable_inspect_custom {
                opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
            }
            let Ok(tag) = Tag::get_advanced(value, global_this, opts) else { return };

            if tag.cell.is_hidden() {
                return;
            }
            if ctx.i == 0 {
                drop(writer);
                if ctx.handle_first_property(global_this, ctx.parent).is_err() {
                    return;
                }
                writer = WrappedWriter {
                    ctx: ctx.writer,
                    failed: false,
                    estimated_line_length: &mut ctx.formatter.estimated_line_length,
                };
            } else {
                this.print_comma::<C>(writer_).expect("unreachable");
            }

            let i_before = ctx.i;
            ctx.i += 1;
            // Re-borrow after possible reseat above.
            let this = &mut *ctx.formatter;

            if i_before > 0 {
                if !this.single_line
                    && (ctx.always_newline || this.always_newline_scope || this.good_time_for_a_new_line())
                {
                    writer.write_all(b"\n");
                    let _ = this.write_indent(writer.ctx);
                    this.reset_line();
                } else {
                    writer.space();
                }
            }

            if !is_symbol {
                // TODO: make this one pass?
                if !key.is_16_bit()
                    && (!this.quote_keys && JSLexer::is_latin1_identifier_u8(key.slice()))
                {
                    this.add_for_new_line(key.len + 1);
                    writer.print(format_args!(
                        concat!("{}", "{}", "{}"),
                        pfmt!("<r>", C),
                        key,
                        pfmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16_bit()
                    && (!this.quote_keys
                        && JSLexer::is_latin1_identifier_u16(key.utf16_slice_aligned()))
                {
                    this.add_for_new_line(key.len + 1);
                    writer.print(format_args!(
                        concat!("{}", "{}", "{}"),
                        pfmt!("<r>", C),
                        key,
                        pfmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16_bit() {
                    let mut utf16_slice = key.utf16_slice_aligned();

                    this.add_for_new_line(utf16_slice.len() + 2);

                    if C {
                        writer.write_all(pfmt!("<r><green>", true).as_bytes());
                    }

                    writer.write_all(b"\"");

                    const QUOTE_U16: &[u16] = &[b'"' as u16];
                    while let Some(j) = strings::immutable::index_of_any16(utf16_slice, QUOTE_U16) {
                        writer.write_16_bit(&utf16_slice[0..j as usize]);
                        writer.write_all(b"\"");
                        utf16_slice = &utf16_slice[j as usize + 1..];
                    }

                    writer.write_16_bit(utf16_slice);

                    writer.print(format_args!(
                        "{}",
                        pfmt!("\"<r><d>:<r> ", C)
                    ));
                } else {
                    this.add_for_new_line(key.len + 2);

                    writer.print(format_args!(
                        "{}{}{}",
                        pfmt!("<r><green>", C),
                        bun_core::fmt::format_json_string_latin1(key.slice()),
                        pfmt!("<r><d>:<r> ", C),
                    ));
                }
            } else if cfg!(debug_assertions) && is_private_symbol {
                this.add_for_new_line(1 + "$:".len() + key.len);
                writer.print(format_args!(
                    "{}{}{}{}",
                    pfmt!("<r><magenta>", C),
                    // PORT NOTE: `ZigString::char_at` lives on the gated
                    // jsc-side impl; inline the 16-bit/latin1 dispatch.
                    if key.len > 0
                        && (if key.is_16bit() {
                            key.utf16_slice_aligned()[0] as u32
                        } else {
                            key.slice()[0] as u32
                        }) == u32::from(b'#')
                    {
                        ""
                    } else {
                        "$"
                    },
                    key,
                    pfmt!("<r><d>:<r> ", C),
                ));
            } else {
                this.add_for_new_line(1 + "[Symbol()]:".len() + key.len);
                writer.print(format_args!(
                    "{}Symbol({}){}",
                    pfmt!("<r><d>[<r><blue>", C),
                    key,
                    pfmt!("<r><d>]:<r> ", C),
                ));
            }

            if tag.cell.is_string_like() {
                if C {
                    writer.write_all(pfmt!("<r><green>", true).as_bytes());
                }
            }

            let _ = this.format::<C>(tag, ctx.writer, value, global_this);

            if tag.cell.is_string_like() {
                if C {
                    writer.write_all(pfmt!("<r>", true).as_bytes());
                }
            }
        }
    }

    fn get_object_name(
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<ZigString>> {
        // TODO(phase-c): body re-gated — `JSValue::get_class_name` /
        // `get_prototype` not yet ported.

        {
            let mut name_str = ZigString::init(b"");
            value.get_class_name(global_this, &mut name_str)?;
            if !name_str.eql_comptime(b"Object") {
                return Ok(Some(name_str));
            } else if value.get_prototype(global_this).eql_value(JSValue::NULL) {
                return Ok(Some(ZigString::static_("[Object: null prototype]")));
            }
        }
        Ok(None)
    }

    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        fn JSC__JSValue__callCustomInspectFunction(
            global: *mut JSGlobalObject,
            function: JSValue,
            this: JSValue,
            depth: u32,
            max_depth: u32,
            colors: bool,
        ) -> JSValue;
        fn JSGlobalObject__throwStackOverflow(global: *const JSGlobalObject);
    }

    // ───────────────────────────────────────────────────────────────────────
    // print_as — the big tag-dispatched printer
    // ───────────────────────────────────────────────────────────────────────

    // TODO(phase-c): re-gated — `print_as` body (~700L) references ~22
    // unported `JSValue`/`ZigString`/`VirtualMachine` methods. Stub provided
    // below; restore arm-by-arm as the missing surface lands.
    
    impl<'a> Formatter<'a> {
        pub fn print_as<const FORMAT: Tag, const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            if self.failed {
                return Ok(());
            }
            if self.global_this.has_exception() {
                return Err(jsc::JsError::Thrown);
            }

            // If we call `return self.print_as(...)` then we can get a spurious
            // `[Circular]` due to the value already being present in the map.
            let mut remove_before_recurse = false;

            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            // PORT NOTE: reshaped for borrowck — `writer` borrows
            // `self.estimated_line_length` mutably while the body also needs
            // `&mut self`. We drop and re-create `writer` around recursive
            // calls; on return we copy `writer.failed` into `self.failed`.
            macro_rules! reseat_writer {
                () => {{
                    let failed = writer.failed;
                    drop(writer);
                    if failed {
                        self.failed = true;
                    }
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };
                }};
            }
            // Zig: `defer { if (writer.failed) this.failed = true; }`.
            // Capture raw pointers so the body can keep using `writer`/`self`;
            // the guard reads the *current* `writer.failed` at scope exit, so
            // every return path (including `?` propagation) is covered.
            let writer_ptr: *const WrappedWriter<'_> = &writer;
            let self_failed_ptr: *mut bool = &mut self.failed;
            let _writer_failed = scopeguard::guard((), move |_| unsafe {
                if (*writer_ptr).failed {
                    *self_failed_ptr = true;
                }
            });

            if FORMAT.can_have_circular_references() {
                if !self.stack_check.is_safe_to_recurse() {
                    self.failed = true;
                    if self.can_throw_stack_overflow {
                        // PORT NOTE: `JSGlobalObject::throw_stack_overflow` lives
                        // on the gated `JSGlobalObject.rs` impl; call the FFI
                        // directly here.
                        // SAFETY: `global_this` is a live `JSGlobalObject`.
                        unsafe { JSGlobalObject__throwStackOverflow(self.global_this) };
                        return Err(jsc::JsError::Thrown);
                    }
                    return Ok(());
                }

                if self.map_node.is_none() {
                    // TODO(port): `visited::Pool` storage isn't wired
                    // (`ObjectPoolType` impl + `object_pool!` storage hook);
                    // until it is, allocate a fresh node directly. Pool reuse
                    // is an optimization only.
                    let node = Box::new(visited::PoolNode {
                        next: core::ptr::null_mut(),
                        data: core::mem::MaybeUninit::new(visited::Map::default()),
                    });
                    self.map = visited::Map::default();
                    self.map_node = Some(node);
                }

                let entry = self.map.get_or_put(value).expect("unreachable");
                if entry.found_existing {
                    writer.write_all(
                        pfmt!("<r><cyan>[Circular]<r>", ENABLE_ANSI_COLORS).as_bytes(),
                    );
                    return Ok(());
                } else {
                    remove_before_recurse = true;
                }
            }

            // Zig: `defer { if (... && remove_before_recurse) _ = this.map.remove(value); }`.
            // The body mutates both `self` and `remove_before_recurse`, so
            // capture raw pointers and read the *current* `remove_before_recurse`
            // at scope-exit time, exactly like Zig's late-evaluated `defer`.
            let map_ptr: *mut visited::Map = &mut self.map;
            let rbr_ptr: *const bool = &remove_before_recurse;
            let _circular_cleanup = scopeguard::guard((), move |_| unsafe {
                if FORMAT.can_have_circular_references() && *rbr_ptr {
                    let _ = (*map_ptr).remove(&value);
                }
            });

            // Helper macro: `pfmt!(fmt, ENABLE_ANSI_COLORS)`.
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, ENABLE_ANSI_COLORS)
                };
            }

            match FORMAT {
                Tag::StringPossiblyFormatted => {
                    let str = value.to_slice(self.global_this)?;
                    let slice = str.slice();
                    self.add_for_new_line(slice.len());
                    reseat_writer!();
                    self.write_with_formatting::<ENABLE_ANSI_COLORS>(writer_, slice, self.global_this)?;
                }
                Tag::String => {
                    // This is called from the '%s' formatter, so it can actually be any value
                    use crate::StringJsc as _;
                    let str: BunString = BunString::from_js(value, self.global_this)?;
                    self.add_for_new_line(str.length());

                    if self.quote_strings && js_type != jsc::JSType::RegExpObject {
                        if str.is_empty() {
                            writer.write_all(b"\"\"");
                            return Ok(());
                        }

                        if ENABLE_ANSI_COLORS {
                            writer.write_all(pfmt!("<r><green>", true).as_bytes());
                        }
                        let writer_reset_ptr: *mut WrappedWriter<'_> = &mut writer;
                        let _reset = scopeguard::guard((), move |_| unsafe {
                            if ENABLE_ANSI_COLORS {
                                (*writer_reset_ptr).write_all(pfmt!("<r>", true).as_bytes());
                            }
                        });

                        if str.is_utf16() {
                            reseat_writer!();
                            self.print_as::<{ Tag::JSON }, ENABLE_ANSI_COLORS>(
                                writer_,
                                value,
                                jsc::JSType::StringObject,
                            )?;
                            return Ok(());
                        }

                        JSPrinter::write_json_string(
                            str.latin1(),
                            writer_,
                            JSPrinter::Encoding::Latin1,
                        )
                        .expect("unreachable");

                        return Ok(());
                    }

                    if js_type == jsc::JSType::StringObject {
                        if ENABLE_ANSI_COLORS {
                            writer.print(format_args!("{}", pf!("<r><green>")));
                        }
                        let writer_reset_ptr: *mut WrappedWriter<'_> = &mut writer;
                        let _reset = scopeguard::guard((), move |_| unsafe {
                            if ENABLE_ANSI_COLORS {
                                (*writer_reset_ptr).write_all(pfmt!("<r>", true).as_bytes());
                            }
                        });

                        writer.print(format_args!("[String: "));

                        if str.is_utf16() {
                            reseat_writer!();
                            self.print_as::<{ Tag::JSON }, ENABLE_ANSI_COLORS>(
                                writer_,
                                value,
                                jsc::JSType::StringObject,
                            )?;
                        } else {
                            JSPrinter::write_json_string(
                                str.latin1(),
                                writer_,
                                JSPrinter::Encoding::Latin1,
                            )
                            .expect("unreachable");
                        }

                        writer.print(format_args!("]"));
                        return Ok(());
                    }

                    if js_type == jsc::JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!("{}", pf!("<r><red>")));
                    }

                    if str.is_utf16() {
                        // streaming print
                        writer.print(format_args!("{str}"));
                    } else if let Some(slice) = str.as_utf8() {
                        // fast path
                        writer.write_all(slice);
                    } else if !str.is_empty() {
                        // slow path
                        let buf = strings::immutable::allocate_latin1_into_utf8(str.latin1())
                            .unwrap_or_default();
                        if !buf.is_empty() {
                            writer.write_all(&buf);
                        }
                    }

                    if js_type == jsc::JSType::RegExpObject && ENABLE_ANSI_COLORS {
                        writer.print(format_args!("{}", pf!("<r>")));
                    }
                }
                Tag::Integer => {
                    let int = value.coerce_to_int64(self.global_this)?;
                    if int < i64::from(u32::MAX) {
                        let mut i = int;
                        let is_negative = i < 0;
                        if is_negative {
                            i = -i;
                        }
                        let digits = if i != 0 {
                            bun_core::fmt::fast_digit_count(u64::try_from(i).unwrap())
                                + (is_negative as u64)
                        } else {
                            1
                        };
                        self.add_for_new_line(digits as usize);
                    } else {
                        self.add_for_new_line(bun_core::fmt::count_int(int));
                    }
                    writer.print(format_args!(
                        "{}{}{}",
                        pf!("<r><yellow>"),
                        int,
                        pf!("<r>")
                    ));
                }
                Tag::BigInt => {
                    let out_str = value.get_zig_string(self.global_this)?.slice();
                    self.add_for_new_line(out_str.len());
                    writer.print(format_args!(
                        "{}{}n{}",
                        pf!("<r><yellow>"),
                        bstr::BStr::new(out_str),
                        pf!("<r>")
                    ));
                }
                Tag::Double => {
                    if value.is_cell() {
                        let mut number_name = ZigString::EMPTY;
                        value.get_class_name(self.global_this, &mut number_name)?;

                        let mut number_value = ZigString::EMPTY;
                        value.to_zig_string(&mut number_value, self.global_this)?;

                        if number_name.slice() != b"Number" {
                            self.add_for_new_line(
                                number_name.len + number_value.len + "[Number ():]".len(),
                            );
                            writer.print(format_args!(
                                "{}[Number ({}): {}]{}",
                                pf!("<r><yellow>"),
                                number_name,
                                number_value,
                                pf!("<r>")
                            ));
                            return Ok(());
                        }

                        self.add_for_new_line(number_name.len + number_value.len + 4);
                        writer.print(format_args!(
                            "{}[{}: {}]{}",
                            pf!("<r><yellow>"),
                            number_name,
                            number_value,
                            pf!("<r>")
                        ));
                        return Ok(());
                    }

                    let num = value.as_number();

                    if num.is_infinite() && num > 0.0 {
                        self.add_for_new_line("Infinity".len());
                        writer.print(format_args!("{}Infinity{}", pf!("<r><yellow>"), pf!("<r>")));
                    } else if num.is_infinite() && num < 0.0 {
                        self.add_for_new_line("-Infinity".len());
                        writer.print(format_args!("{}-Infinity{}", pf!("<r><yellow>"), pf!("<r>")));
                    } else if num.is_nan() {
                        self.add_for_new_line("NaN".len());
                        writer.print(format_args!("{}NaN{}", pf!("<r><yellow>"), pf!("<r>")));
                    } else {
                        let mut buf = [0u8; 124];
                        let formatted =
                            bun_core::fmt::FormatDouble::dtoa_with_negative_zero(&mut buf, num);
                        self.add_for_new_line(formatted.len());
                        writer.print(format_args!(
                            "{}{}{}",
                            pf!("<r><yellow>"),
                            bstr::BStr::new(formatted),
                            pf!("<r>")
                        ));
                    }
                }
                Tag::Undefined => {
                    self.add_for_new_line(9);
                    writer.print(format_args!("{}undefined{}", pf!("<r><d>"), pf!("<r>")));
                }
                Tag::Null => {
                    self.add_for_new_line(4);
                    writer.print(format_args!("{}null{}", pf!("<r><yellow>"), pf!("<r>")));
                }
                Tag::CustomFormattedObject => {
                    // Call custom inspect function. Will return the error if there
                    // is one; we'll need to pass the callback through to the "this"
                    // value in here.
                    // SAFETY: FFI call; `global_this` is a valid `JSGlobalObject` for
                    // the call's duration. `JSGlobalObject` is an opaque handle with
                    // `UnsafeCell` interior, so `.as_ptr()` yields a `*mut` with write
                    // provenance — the C++ callee may mutate VM state through it.
                    let result = crate::from_js_host_call(self.global_this, || unsafe {
                        JSC__JSValue__callCustomInspectFunction(
                            self.global_this.as_ptr(),
                            self.custom_formatted_object.function,
                            self.custom_formatted_object.this,
                            u32::from(self.max_depth.saturating_sub(self.depth)),
                            u32::from(self.max_depth),
                            ENABLE_ANSI_COLORS,
                        )
                    })?;
                    // Strings are printed directly, otherwise we recurse. It is
                    // possible to end up in an infinite loop.
                    if result.is_string() {
                        writer.print(format_args!("{}", result.fmt_string(self.global_this)));
                    } else {
                        reseat_writer!();
                        self.format::<ENABLE_ANSI_COLORS>(
                            Tag::get(result, self.global_this)?,
                            writer_,
                            result,
                            self.global_this,
                        )?;
                    }
                }
                Tag::Symbol => {
                    let description = value.get_description(self.global_this);
                    self.add_for_new_line("Symbol".len());

                    if description.len > 0 {
                        self.add_for_new_line(description.len + "()".len());
                        writer.print(format_args!(
                            "{}Symbol({}){}",
                            pf!("<r><blue>"),
                            description,
                            pf!("<r>")
                        ));
                    } else {
                        writer.print(format_args!("{}Symbol(){}", pf!("<r><blue>"), pf!("<r>")));
                    }
                }
                Tag::Error => {
                    // Temporarily remove from the visited map to allow
                    // printErrorlikeObject to process it. The circular reference
                    // check is already done in print_as, so we know it's safe.
                    let was_in_map = if self.map_node.is_some() {
                        self.map.remove(&value).is_some()
                    } else {
                        false
                    };
                    let map_restore_ptr: *mut visited::Map = &mut self.map;
                    let _restore = scopeguard::guard((), move |_| unsafe {
                        if was_in_map {
                            let _ = (*map_restore_ptr).insert(value, ());
                        }
                    });

                    reseat_writer!();
                    // TODO(port): `VirtualMachine::print_errorlike_object` takes
                    // `&mut bun_core::io::Writer`, not `&mut dyn bun_io::Write`;
                    // adapter pending. Suppress unused for now.
                    let _ = (value, &mut *self, &mut *writer_, ENABLE_ANSI_COLORS);
                    todo!("blocked_on: VirtualMachine::print_errorlike_object writer adapter");
                }
                Tag::Class => {
                    // Prefer the constructor's own `.name` property over
                    // `getClassName` / `calculatedClassName`. For DOM / WebCore
                    // InternalFunction constructors like `ReadableStreamBYOBReader`,
                    // `calculatedClassName` walks the prototype chain and hits
                    // `Function.prototype.constructor === Function`, returning
                    // "Function". The `.name` property is set to the real class
                    // name on the constructor itself. See #29225.
                    let printable = value.get_name(self.global_this)?;
                    self.add_for_new_line(printable.length());

                    // Only report `extends` when the parent is itself a class
                    // (i.e. `class Foo extends Bar`). Built-in and DOM constructors
                    // have `Function.prototype` as their prototype, which would
                    // render as `[class X extends Function]` and is noise.
                    let proto = value.get_prototype(self.global_this);
                    let proto_is_class = !proto.is_empty_or_undefined_or_null()
                        && proto.is_cell()
                        && proto.is_class(self.global_this);
                    let printable_proto: BunString = if proto_is_class {
                        proto.get_name(self.global_this)?
                    } else {
                        BunString::empty()
                    };
                    self.add_for_new_line(printable_proto.length());

                    if printable.is_empty() {
                        if printable_proto.is_empty() {
                            writer.print(format_args!(
                                "{}[class (anonymous)]{}",
                                pf!("<cyan>"),
                                pf!("<r>")
                            ));
                        } else {
                            writer.print(format_args!(
                                "{}[class (anonymous) extends {}]{}",
                                pf!("<cyan>"),
                                printable_proto,
                                pf!("<r>")
                            ));
                        }
                    } else if printable_proto.is_empty() {
                        writer.print(format_args!(
                            "{}[class {}]{}",
                            pf!("<cyan>"),
                            printable,
                            pf!("<r>")
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[class {} extends {}]{}",
                            pf!("<cyan>"),
                            printable,
                            printable_proto,
                            pf!("<r>")
                        ));
                    }
                }
                Tag::Function => {
                    let printable = value.get_name(self.global_this)?;

                    let proto = value.get_prototype(self.global_this);
                    // "Function" | "AsyncFunction" | "GeneratorFunction" | "AsyncGeneratorFunction"
                    let func_name = proto.get_name(self.global_this)?;

                    if printable.is_empty() || func_name.eql(&printable) {
                        if func_name.is_empty() {
                            writer.print(format_args!("{}[Function]{}", pf!("<cyan>"), pf!("<r>")));
                        } else {
                            writer.print(format_args!(
                                "{}[{}]{}",
                                pf!("<cyan>"),
                                func_name,
                                pf!("<r>")
                            ));
                        }
                    } else if func_name.is_empty() {
                        writer.print(format_args!(
                            "{}[Function: {}]{}",
                            pf!("<cyan>"),
                            printable,
                            pf!("<r>")
                        ));
                    } else {
                        writer.print(format_args!(
                            "{}[{}: {}]{}",
                            pf!("<cyan>"),
                            func_name,
                            printable,
                            pf!("<r>")
                        ));
                    }
                }
                Tag::GetterSetter => {
                    // SAFETY: `Tag::GetterSetter` is only produced for cell values.
                    let cell = unsafe { &*value.to_cell().expect("GetterSetter is a cell") };
                    let getter_setter = cell.get_getter_setter();
                    let has_getter = !getter_setter.is_getter_null();
                    let has_setter = !getter_setter.is_setter_null();
                    if has_getter && has_setter {
                        writer.print(format_args!("{}[Getter/Setter]{}", pf!("<cyan>"), pf!("<r>")));
                    } else if has_getter {
                        writer.print(format_args!("{}[Getter]{}", pf!("<cyan>"), pf!("<r>")));
                    } else if has_setter {
                        writer.print(format_args!("{}[Setter]{}", pf!("<cyan>"), pf!("<r>")));
                    }
                }
                Tag::CustomGetterSetter => {
                    // SAFETY: `Tag::CustomGetterSetter` is only produced for cell values.
                    let cell = unsafe { &*value.to_cell().expect("CustomGetterSetter is a cell") };
                    let getter_setter = cell.get_custom_getter_setter();
                    let has_getter = !getter_setter.is_getter_null();
                    let has_setter = !getter_setter.is_setter_null();
                    if has_getter && has_setter {
                        writer.print(format_args!("{}[Getter/Setter]{}", pf!("<cyan>"), pf!("<r>")));
                    } else if has_getter {
                        writer.print(format_args!("{}[Getter]{}", pf!("<cyan>"), pf!("<r>")));
                    } else if has_setter {
                        writer.print(format_args!("{}[Setter]{}", pf!("<cyan>"), pf!("<r>")));
                    }
                }
                Tag::Array => {
                    reseat_writer!();
                    self.print_array::<ENABLE_ANSI_COLORS>(writer_, value, js_type)?;
                }
                Tag::Private => {
                    reseat_writer!();
                    self.print_private::<ENABLE_ANSI_COLORS>(
                        writer_,
                        value,
                        js_type,
                        &mut remove_before_recurse,
                    )?;
                }
                Tag::NativeCode => {
                    if let Some(class_name) = value.get_class_info_name() {
                        self.add_for_new_line("[native code: ]".len() + class_name.len());
                        writer.write_all(b"[native code: ");
                        writer.write_all(class_name);
                        writer.write_all(b"]");
                    } else {
                        self.add_for_new_line("[native code]".len());
                        writer.write_all(b"[native code]");
                    }
                }
                Tag::Promise => {
                    if !self.single_line && self.good_time_for_a_new_line() {
                        writer.write_all(b"\n");
                        let _ = self.write_indent(writer_);
                    }

                    writer.write_all(b"Promise { ");
                    writer.write_all(pf!("<r><cyan>").as_bytes());

                    // SAFETY: value is a Promise (Tag::Promise).
                    let promise: &JSPromise =
                        unsafe { &*(value.as_object_ref() as *const JSPromise) };
                    match promise.status() {
                        jsc::js_promise::Status::Pending => writer.write_all(b"<pending>"),
                        jsc::js_promise::Status::Fulfilled => writer.write_all(b"<resolved>"),
                        jsc::js_promise::Status::Rejected => writer.write_all(b"<rejected>"),
                    }

                    writer.write_all(pf!("<r>").as_bytes());
                    writer.write_all(b" }");
                }
                Tag::Boolean => {
                    if value.is_cell() {
                        let mut bool_name = ZigString::EMPTY;
                        value.get_class_name(self.global_this, &mut bool_name)?;
                        let mut bool_value = ZigString::EMPTY;
                        value.to_zig_string(&mut bool_value, self.global_this)?;

                        if bool_name.slice() != b"Boolean" {
                            self.add_for_new_line(
                                bool_value.len + bool_name.len + "[Boolean (): ]".len(),
                            );
                            writer.print(format_args!(
                                "{}[Boolean ({}): {}]{}",
                                pf!("<r><yellow>"),
                                bool_name,
                                bool_value,
                                pf!("<r>")
                            ));
                            return Ok(());
                        }
                        self.add_for_new_line(bool_value.len + "[Boolean: ]".len());
                        writer.print(format_args!(
                            "{}[Boolean: {}]{}",
                            pf!("<r><yellow>"),
                            bool_value,
                            pf!("<r>")
                        ));
                        return Ok(());
                    }
                    if value.to_boolean() {
                        self.add_for_new_line(4);
                        writer.write_all(pf!("<r><yellow>true<r>").as_bytes());
                    } else {
                        self.add_for_new_line(5);
                        writer.write_all(pf!("<r><yellow>false<r>").as_bytes());
                    }
                }
                Tag::GlobalObject => {
                    const FMT: &str = "[Global Object]";
                    self.add_for_new_line(FMT.len());
                    writer.write_all(
                        pfmt!(concat!("<cyan>", "[Global Object]", "<r>"), ENABLE_ANSI_COLORS)
                            .as_bytes(),
                    );
                }
                Tag::Map => {
                    reseat_writer!();
                    self.print_map_like::<ENABLE_ANSI_COLORS, false>(writer_, value)?;
                }
                Tag::MapIterator => {
                    reseat_writer!();
                    self.print_map_iterator_like::<ENABLE_ANSI_COLORS>(writer_, value, "MapIterator")?;
                }
                Tag::SetIterator => {
                    reseat_writer!();
                    self.print_map_iterator_like::<ENABLE_ANSI_COLORS>(writer_, value, "SetIterator")?;
                }
                Tag::Set => {
                    reseat_writer!();
                    self.print_set::<ENABLE_ANSI_COLORS>(writer_, value)?;
                }
                Tag::ToJSON => {
                    if let Some(func) = value.get(self.global_this, "toJSON")? {
                        match func.call(self.global_this, value, &[]) {
                            Err(_) => {
                                // PORT NOTE: `JSGlobalObject::clear_exception`
                                // lives on the gated `JSGlobalObject.rs` impl;
                                // `try_take_exception()` clears + returns it,
                                // so discard the value to get the same effect.
                                let _ = self.global_this.try_take_exception();
                            }
                            Ok(result) => {
                                let prev_quote_keys = self.quote_keys;
                                self.quote_keys = true;
                                let _r = defer_restore!(self.quote_keys, prev_quote_keys);
                                let tag = Tag::get(result, self.global_this)?;
                                reseat_writer!();
                                self.format::<ENABLE_ANSI_COLORS>(tag, writer_, result, self.global_this)?;
                                return Ok(());
                            }
                        }
                    }

                    writer.write_all(b"{}");
                }
                Tag::JSON => {
                    let mut str = BunString::empty();

                    value.json_stringify(self.global_this, self.indent, &mut str)?;
                    self.add_for_new_line(str.length());
                    if js_type == jsc::JSType::JSDate {
                        // in the code for printing dates, it never exceeds this amount
                        let mut iso_string_buf = [0u8; 36];
                        // TODO(port): bufPrint equivalent
                        let mut out_buf: &[u8] = {
                            use std::io::Write as _;
                            let mut cursor = &mut iso_string_buf[..];
                            let start_len = cursor.len();
                            let _ = write!(cursor, "{str}");
                            let written = start_len - cursor.len();
                            &iso_string_buf[..written]
                        };

                        if out_buf == b"null" {
                            out_buf = b"Invalid Date";
                        } else if out_buf.len() > 2 {
                            // trim the quotes
                            out_buf = &out_buf[1..out_buf.len() - 1];
                        }

                        writer.print(format_args!(
                            "{}{}{}",
                            pf!("<r><magenta>"),
                            bstr::BStr::new(out_buf),
                            pf!("<r>")
                        ));
                        return Ok(());
                    }

                    writer.print(format_args!("{str}"));
                }
                Tag::Event => {
                    reseat_writer!();
                    self.print_event::<ENABLE_ANSI_COLORS>(
                        writer_,
                        value,
                        &mut remove_before_recurse,
                    )?;
                }
                Tag::JSX => {
                    reseat_writer!();
                    self.print_jsx::<ENABLE_ANSI_COLORS>(writer_, value)?;
                }
                Tag::Object => {
                    reseat_writer!();
                    self.print_object::<ENABLE_ANSI_COLORS>(writer_, value, js_type)?;
                }
                Tag::TypedArray => {
                    reseat_writer!();
                    self.print_typed_array::<ENABLE_ANSI_COLORS>(writer_, value, js_type)?;
                }
                Tag::RevokedProxy => {
                    self.add_for_new_line("<Revoked Proxy>".len());
                    writer.print(format_args!(
                        "{}<Revoked Proxy>{}",
                        pf!("<r><cyan>"),
                        pf!("<r>")
                    ));
                }
                Tag::Proxy => {
                    let target = value.get_proxy_internal_field(jsc::ProxyField::Target);
                    if cfg!(debug_assertions) {
                        // Proxy does not allow non-objects here.
                        debug_assert!(target.is_cell());
                    }
                    // TODO: if (options.showProxy), print like
                    // `Proxy { target: ..., handlers: ... }` — this is default
                    // off so it is not used.
                    reseat_writer!();
                    self.format::<ENABLE_ANSI_COLORS>(
                        Tag::get(target, self.global_this)?,
                        writer_,
                        target,
                        self.global_this,
                    )?;
                }
                // Exhaustive — `StringPossiblyFormatted` already handled above.
                Tag::StringPossiblyFormatted => unreachable!(),
            }

            // Mirror Zig `defer { if writer.failed self.failed = true }`.
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Per-tag helpers split out of print_as for borrowck sanity
    //
    // PORT NOTE: in Zig these were inline `switch` arms in `printAs`. They are
    // hoisted here because each one needs `&mut self` plus the underlying
    // writer while the parent scope holds a `WrappedWriter` that borrows
    // `self.estimated_line_length`. Logic and ordering are preserved 1:1.
    // ───────────────────────────────────────────────────────────────────────

    // TODO(phase-c): re-gated — `print_array`/`print_object`/… bodies (~1200L)
    // reference ~40 unported `JSValue` methods. `format` dispatcher stubbed
    // below; restore once `print_as` un-gates.
    
    impl<'a> Formatter<'a> {
        fn tag_opts(&self) -> TagOptions {
            let mut opts = TagOptions::HIDE_GLOBAL;
            if self.disable_inspect_custom {
                opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
            }
            opts
        }

        fn print_array<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            // Cache once: `disable_inspect_custom` does not change inside this
            // function, and `WrappedWriter` holds `&mut self.estimated_line_length`
            // which prevents calling `&self` methods while it is live.
            let tag_opts = self.tag_opts();
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            macro_rules! pf { ($s:literal) => { pfmt!($s, C) }; }

            let len = value.get_length(self.global_this)?;

            // TODO: DerivedArray does not get passed along in JSType, and it's
            // not clear why.

            if len == 0 {
                writer.write_all(b"[]");
                self.add_for_new_line(2);
                return Ok(());
            }

            let mut was_good_time = self.always_newline_scope ||
                // heuristic: more than 10, probably should have a newline before it
                len > 10;
            {
                self.indent += 1;
                self.depth += 1;
                let _depth = defer_decrement!(self.depth);
                let _indent = defer_decrement!(self.indent);

                self.add_for_new_line(2);

                let prev_quote_strings = self.quote_strings;
                self.quote_strings = true;
                let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
                let mut empty_start: Option<u32> = None;
                'first: {
                    let element = value.get_direct_index(self.global_this, 0);

                    let tag = Tag::get_advanced(element, self.global_this, self.tag_opts())?;

                    was_good_time =
                        was_good_time || !tag.tag.is_primitive() || self.good_time_for_a_new_line();

                    if !self.single_line && (self.ordered_properties || was_good_time) {
                        self.reset_line();
                        writer.write_all(b"[");
                        writer.write_all(b"\n");
                        self.write_indent(writer.ctx).expect("unreachable");
                        self.add_for_new_line(1);
                    } else {
                        writer.write_all(b"[ ");
                        self.add_for_new_line(2);
                    }

                    if element.is_empty() {
                        empty_start = Some(0);
                        break 'first;
                    }

                    drop(writer);
                    self.format::<C>(tag, writer_, element, self.global_this)?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };

                    if tag.cell.is_string_like() && C {
                        writer.write_all(pfmt!("<r>", true).as_bytes());
                    }
                }

                let mut i: u32 = 1;
                let mut nonempty_count: u32 = 1;

                while (i as u64) < len {
                    let element = value.get_direct_index(self.global_this, i);
                    if element.is_empty() {
                        if empty_start.is_none() {
                            empty_start = Some(i);
                        }
                        i += 1;
                        continue;
                    }
                    if nonempty_count >= 100 {
                        self.print_comma::<C>(writer.ctx).expect("unreachable");
                        writer.write_all(b"\n"); // we want the line break to be unconditional here
                        self.estimated_line_length = 0;
                        self.write_indent(writer.ctx).expect("unreachable");
                        writer.pretty::<C>(
                            "... N more items".len(),
                            format_args!("{}... {} more items{}", pf!("<r><d>"), len - u64::from(i), pf!("<r>")),
                        );
                        break;
                    }
                    nonempty_count += 1;

                    if let Some(empty) = empty_start {
                        if empty > 0 {
                            self.print_comma::<C>(writer.ctx).expect("unreachable");
                            if !self.single_line
                                && (self.ordered_properties || self.good_time_for_a_new_line())
                            {
                                was_good_time = true;
                                writer.write_all(b"\n");
                                self.write_indent(writer.ctx).expect("unreachable");
                            } else {
                                writer.space();
                            }
                        }
                        let empty_count = i - empty;
                        if empty_count == 1 {
                            writer.pretty::<C>(
                                "empty item".len(),
                                format_args!("{}empty item{}", pf!("<r><d>"), pf!("<r>")),
                            );
                        } else {
                            self.estimated_line_length +=
                                bun_core::fmt::fast_digit_count(u64::from(empty_count)) as usize;
                            writer.pretty::<C>(
                                " x empty items".len(),
                                format_args!(
                                    "{}{} x empty items{}",
                                    pf!("<r><d>"),
                                    empty_count,
                                    pf!("<r>")
                                ),
                            );
                        }
                        empty_start = None;
                    }

                    writer.print_comma::<C>();
                    if !self.single_line
                        && (self.ordered_properties || writer.good_time_for_a_new_line(self.indent))
                    {
                        writer.write_all(b"\n");
                        was_good_time = true;
                        writer.write_indent(self.indent);
                    } else {
                        writer.space();
                    }

                    let tag = Tag::get_advanced(element, self.global_this, tag_opts)?;

                    drop(writer);
                    self.format::<C>(tag, writer_, element, self.global_this)?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };

                    if tag.cell.is_string_like() && C {
                        writer.write_all(pfmt!("<r>", true).as_bytes());
                    }
                    i += 1;
                }

                if let Some(empty) = empty_start.take() {
                    if empty > 0 {
                        self.print_comma::<C>(writer.ctx).expect("unreachable");
                        if !self.single_line
                            && (self.ordered_properties || self.good_time_for_a_new_line())
                        {
                            writer.write_all(b"\n");
                            was_good_time = true;
                            self.write_indent(writer.ctx).expect("unreachable");
                        } else {
                            writer.space();
                        }
                    }

                    let empty_count = len - u64::from(empty);
                    if empty_count == 1 {
                        writer.pretty::<C>(
                            "empty item".len(),
                            format_args!("{}empty item{}", pf!("<r><d>"), pf!("<r>")),
                        );
                    } else {
                        self.estimated_line_length +=
                            bun_core::fmt::fast_digit_count(empty_count) as usize;
                        writer.pretty::<C>(
                            " x empty items".len(),
                            format_args!(
                                "{}{} x empty items{}",
                                pf!("<r><d>"),
                                empty_count,
                                pf!("<r>")
                            ),
                        );
                    }
                }

                if !js_type.is_arguments() {
                    drop(writer);
                    let mut iter = PropertyIteratorCtx::<C> {
                        formatter: self,
                        writer: writer_,
                        always_newline: !self.single_line
                            && (self.always_newline_scope || self.good_time_for_a_new_line()),
                        single_line: self.single_line,
                        parent: value,
                        i: i as usize,
                    };
                    value.for_each_property_non_indexed(
                        self.global_this,
                        &mut iter as *mut _ as *mut c_void,
                        PropertyIteratorCtx::<C>::for_each,
                    )?;
                    if self.failed {
                        return Ok(());
                    }
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };
                }
            }

            if !self.single_line
                && (self.ordered_properties || was_good_time || self.good_time_for_a_new_line())
            {
                self.reset_line();
                writer.write_all(b"\n");
                let _ = self.write_indent(writer.ctx);
                writer.write_all(b"]");
                self.reset_line();
                self.add_for_new_line(1);
            } else {
                writer.write_all(b" ]");
                self.add_for_new_line(2);
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        fn print_private<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
            remove_before_recurse: &mut bool,
        ) -> JsResult<()> {
            // TODO(port): each `value.as::<T>()` downcast below maps to
            // `crate::JsClass::from_js`. The list of types is preserved.
            macro_rules! pf { ($s:literal) => { pfmt!($s, C) }; }
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };

            // TODO(port-cycle): the `bun_runtime` `JsClass` downcasts (Response,
            // Request, BuildArtifact, Blob, S3Client, Archive, FetchHeaders,
            // TimeoutObject, ImmediateObject, BuildMessage, ResolveMessage) and
            // `JestPrettyFormat::print_asymmetric_matcher` form a high-tier
            // crate cycle (`bun_jsc → bun_runtime → bun_jsc`). They are gated
            // here as a single block; the always-live tail (DOMFormData +
            // non-DOMWrapper fallback) is preserved below so generic objects
            // still print. Restored once the runtime types implement a
            // dyn-erased `WriteFormat` hook this crate can call without naming
            // them.
            #[cfg(any())]
            if let Some(response) = value.as_::<bun_runtime::webcore::Response>() {
                let _ = response.write_format::<C>(self, writer_);
                return Ok(());
            } else if let Some(request) = value.as_::<bun_runtime::webcore::Request>() {
                let _ = request.write_format::<C>(value, self, writer_);
                return Ok(());
            } else if let Some(build) = value.as_::<bun_runtime::api::BuildArtifact>() {
                let _ = build.write_format::<C>(self, writer_);
                return Ok(());
            } else if let Some(blob) = value.as_::<bun_runtime::webcore::Blob>() {
                let _ = blob.write_format::<C>(self, writer_);
                return Ok(());
            } else if let Some(s3client) = value.as_::<bun_runtime::webcore::S3Client>() {
                let _ = s3client.write_format::<C>(self, writer_);
                return Ok(());
            } else if let Some(archive) = value.as_::<bun_runtime::api::Archive>() {
                let _ = archive.write_format::<C>(self, writer_);
                return Ok(());
            } else if value.as_::<bun_runtime::webcore::FetchHeaders>().is_some() {
                if let Some(to_json_function) = value.get(self.global_this, "toJSON")? {
                    self.add_for_new_line("Headers ".len());
                    writer.write_all(pf!("<r>Headers ").as_bytes());
                    let prev_quote_keys = self.quote_keys;
                    self.quote_keys = true;
                    let _r = defer_restore!(self.quote_keys, prev_quote_keys);

                    let result = to_json_function
                        .call(self.global_this, value, &[])
                        .unwrap_or_else(|err| self.global_this.take_exception(err));
                    return self.print_as::<{ Tag::Object }, C>(writer_, result, jsc::JSType::Object);
                }
            } else if let Some(timer) = value.as_::<bun_runtime::api::timer::TimeoutObject>() {
                self.add_for_new_line(
                    "Timeout(# ) ".len()
                        + bun_core::fmt::fast_digit_count(timer.internals.id.max(0) as u64) as usize,
                );
                if timer.internals.flags.kind == bun_runtime::api::timer::Kind::SetInterval {
                    self.add_for_new_line(
                        "repeats ".len()
                            + bun_core::fmt::fast_digit_count(timer.internals.id.max(0) as u64) as usize,
                    );
                    writer.print(format_args!(
                        "{}Timeout{} {}(#{}{}{}{}, repeats){}",
                        pf!("<r><blue>"), pf!("<r>"), pf!("<d>"), pf!("<yellow>"),
                        timer.internals.id, pf!("<r>"), pf!("<d>"), pf!("<r>")
                    ));
                } else {
                    writer.print(format_args!(
                        "{}Timeout{} {}(#{}{}{}{}){}",
                        pf!("<r><blue>"), pf!("<r>"), pf!("<d>"), pf!("<yellow>"),
                        timer.internals.id, pf!("<r>"), pf!("<d>"), pf!("<r>")
                    ));
                }
                return Ok(());
            } else if let Some(immediate) = value.as_::<bun_runtime::api::timer::ImmediateObject>() {
                self.add_for_new_line(
                    "Immediate(# ) ".len()
                        + bun_core::fmt::fast_digit_count(immediate.internals.id.max(0) as u64) as usize,
                );
                writer.print(format_args!(
                    "{}Immediate{} {}(#{}{}{}{}){}",
                    pf!("<r><blue>"), pf!("<r>"), pf!("<d>"), pf!("<yellow>"),
                    immediate.internals.id, pf!("<r>"), pf!("<d>"), pf!("<r>")
                ));
                return Ok(());
            } else if let Some(build_log) = value.as_::<bun_runtime::api::BuildMessage>() {
                let _ = build_log.msg.write_format::<C>(writer_);
                return Ok(());
            } else if let Some(resolve_log) = value.as_::<bun_runtime::api::ResolveMessage>() {
                let _ = resolve_log.msg.write_format::<C>(writer_);
                return Ok(());
            } else if NAME_BUF.with_borrow_mut(|buf| {
                JestPrettyFormat::print_asymmetric_matcher::<C>(
                    self, &mut writer, writer_, buf, value,
                )
            })? {
                return Ok(());
            }

            let _ = (&mut writer, pf!("<r>")); // silence unused while gated above
            // TODO(port-cycle): `crate::DOMFormData` is a `stub_ty!` placeholder
            // (no `JsClass` impl yet); the real downcast lives behind the
            // gated `bun_runtime` block above. Hard-disabled until the
            // `DOMFormData` JsClass derive lands.
            if false /* value.as_::<crate::DOMFormData>().is_some() */ {
                if let Some(to_json_function) = value.get(self.global_this, "toJSON")? {
                    let prev_quote_keys = self.quote_keys;
                    self.quote_keys = true;
                    let _r = defer_restore!(self.quote_keys, prev_quote_keys);

                    let result = to_json_function
                        .call(self.global_this, value, &[])
                        .unwrap_or_else(|err| self.global_this.take_exception(err));
                    return self.print_as::<{ Tag::Object }, C>(writer_, result, jsc::JSType::Object);
                }

                // this case should never happen
                return self
                    .print_as::<{ Tag::Undefined }, C>(writer_, JSValue::UNDEFINED, jsc::JSType::Cell);
            } else if js_type != jsc::JSType::DOMWrapper {
                if *remove_before_recurse {
                    *remove_before_recurse = false;
                    let _ = self.map.remove(&value);
                }

                if value.is_callable() {
                    *remove_before_recurse = true;
                    return self.print_as::<{ Tag::Function }, C>(writer_, value, js_type);
                }

                *remove_before_recurse = true;
                return self.print_as::<{ Tag::Object }, C>(writer_, value, js_type);
            }
            if *remove_before_recurse {
                *remove_before_recurse = false;
                let _ = self.map.remove(&value);
            }

            *remove_before_recurse = true;
            self.print_as::<{ Tag::Object }, C>(writer_, value, jsc::JSType::Event)
        }

        fn print_map_like<const C: bool, const _UNUSED: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let length_value = value
                .get(self.global_this, "size")?
                .unwrap_or_else(|| JSValue::js_number_from_int32(0));
            let length = length_value.coerce_to_i32(self.global_this)?;

            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            let map_name = if value.js_type() == jsc::JSType::WeakMap { "WeakMap" } else { "Map" };

            if length == 0 {
                let _ = write!(writer_, "{map_name} {{}}");
                return Ok(());
            }

            if self.single_line {
                let _ = write!(writer_, "{map_name}({length}) {{ ");
            } else {
                let _ = write!(writer_, "{map_name}({length}) {{\n");
            }
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let _i = defer_decrement!(self.indent);
                let _d = defer_decrement!(self.depth);
                // PERF(port): was comptime bool dispatch on single_line — profile in Phase B
                let global_this = self.global_this;
                if self.single_line {
                    let mut iter = MapIteratorCtx::<C, false, true> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, false, true>::for_each)?;
                    let count = iter.count;
                    if iter.formatter.failed { return Ok(()); }
                    if count > 0 { let _ = writer_.write_all(b" "); }
                } else {
                    let mut iter = MapIteratorCtx::<C, false, false> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, false, false>::for_each)?;
                    if iter.formatter.failed { return Ok(()); }
                }
            }
            if !self.single_line {
                let _ = self.write_indent(writer_);
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        fn print_map_iterator_like<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            label: &'static str,
        ) -> JsResult<()> {
            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            let _ = write!(writer_, "{label} {{ ");
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let _i = defer_decrement!(self.indent);
                let _d = defer_decrement!(self.depth);
                let global_this = self.global_this;
                if self.single_line {
                    let mut iter = MapIteratorCtx::<C, true, true> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, true, true>::for_each)?;
                    let count = iter.count;
                    if iter.formatter.failed { return Ok(()); }
                    // Spec divergence: Zig's `.SetIterator` arm writes NOTHING in
                    // single-line mode (`if (count > 0 and !single_line) writeAll("\n")`),
                    // only `.MapIterator` writes a trailing space.
                    if count > 0 && label == "MapIterator" {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = MapIteratorCtx::<C, true, false> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, true, false>::for_each)?;
                    let count = iter.count;
                    if iter.formatter.failed { return Ok(()); }
                    if count > 0 {
                        let _ = writer_.write_all(b"\n");
                    }
                }
            }
            if !self.single_line {
                let _ = self.write_indent(writer_);
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        fn print_set<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let length_value = value
                .get(self.global_this, "size")?
                .unwrap_or_else(|| JSValue::js_number_from_int32(0));
            let length = length_value.coerce_to_i32(self.global_this)?;

            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            let set_name = if value.js_type() == jsc::JSType::WeakSet { "WeakSet" } else { "Set" };

            if length == 0 {
                let _ = write!(writer_, "{set_name} {{}}");
                return Ok(());
            }

            if self.single_line {
                let _ = write!(writer_, "{set_name}({length}) {{ ");
            } else {
                let _ = write!(writer_, "{set_name}({length}) {{\n");
            }
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let _i = defer_decrement!(self.indent);
                let _d = defer_decrement!(self.depth);
                let global_this = self.global_this;
                if self.single_line {
                    let mut iter = SetIteratorCtx::<C, true> {
                        formatter: self, writer: writer_, is_first: true,
                    };
                    value.for_each(global_this, &mut iter as *mut _ as *mut c_void,
                        SetIteratorCtx::<C, true>::for_each)?;
                    let is_first = iter.is_first;
                    if iter.formatter.failed { return Ok(()); }
                    if !is_first { let _ = writer_.write_all(b" "); }
                } else {
                    let mut iter = SetIteratorCtx::<C, false> {
                        formatter: self, writer: writer_, is_first: true,
                    };
                    value.for_each(global_this, &mut iter as *mut _ as *mut c_void,
                        SetIteratorCtx::<C, false>::for_each)?;
                    if iter.formatter.failed { return Ok(()); }
                }
            }
            if !self.single_line {
                let _ = self.write_indent(writer_);
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        fn print_event<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            remove_before_recurse: &mut bool,
        ) -> JsResult<()> {
            macro_rules! pf { ($s:literal) => { pfmt!($s, C) }; }

            let event_type_value: JSValue = 'brk: {
                let Some(value_) = value.get(self.global_this, "type")? else {
                    break 'brk JSValue::UNDEFINED;
                };
                if value_.is_string() {
                    break 'brk value_;
                }
                JSValue::UNDEFINED
            };

            // PORT NOTE: Zig `EventType.map.fromJS` is `ComptimeEnumMap.fromJS`;
            // here the value is already known to be a JS string (or `undefined`),
            // so we coerce to a `ZigString` and look it up in the static `phf`
            // map directly.
            let event_type = match {
                let mut s = ZigString::init(b"");
                if event_type_value.is_string() {
                    event_type_value.to_zig_string(&mut s, self.global_this)?;
                }
                EventType::MAP.get(s.slice()).copied().unwrap_or(EventType::unknown)
            } {
                evt @ (EventType::MessageEvent | EventType::ErrorEvent) => evt,
                _ => {
                    if *remove_before_recurse {
                        let _ = self.map.remove(&value);
                    }
                    // We must potentially remove it again.
                    *remove_before_recurse = true;
                    return self.print_as::<{ Tag::Object }, C>(writer_, value, jsc::JSType::Event);
                }
            };

            // PORT NOTE: Zig `@tagName(event_type)`. `EventType` is a transparent
            // u8 newtype (non-exhaustive enum), so there is no derived `From<EventType>
            // for &str`; only the two arms above can reach here.
            let event_tag_name: &'static str = match event_type {
                EventType::MessageEvent => "MessageEvent",
                EventType::ErrorEvent => "ErrorEvent",
                _ => unreachable!(),
            };
            let _ = write!(
                writer_,
                "{}{}{} {{\n",
                pf!("<r><cyan>"),
                event_tag_name,
                pf!("<r>")
            );
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let _i = defer_decrement!(self.indent);
                let _d = defer_decrement!(self.depth);
                let old_quote_strings = self.quote_strings;
                self.quote_strings = true;
                let _qs = defer_restore!(self.quote_strings, old_quote_strings);
                self.write_indent(writer_).expect("unreachable");

                if self.single_line {
                    let _ = write!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{} ",
                        pf!("<r>"), pf!("<green>"), bstr::BStr::new(event_type.label()), pf!("<r>"), pf!("<d>"), pf!("<r>")
                    );
                } else {
                    let _ = write!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{}\n",
                        pf!("<r>"), pf!("<green>"), bstr::BStr::new(event_type.label()), pf!("<r>"), pf!("<d>"), pf!("<r>")
                    );
                }

                if let Some(message_value) = value.fast_get(self.global_this, jsc::BuiltinName::Message)? {
                    if message_value.is_string() {
                        if !self.single_line {
                            self.write_indent(writer_).expect("unreachable");
                        }
                        let _ = write!(writer_, "{}message{}:{} ", pf!("<r><blue>"), pf!("<d>"), pf!("<r>"));
                        let tag = Tag::get_advanced(message_value, self.global_this, self.tag_opts())?;
                        self.format::<C>(tag, writer_, message_value, self.global_this)?;
                        if self.failed { return Ok(()); }
                        self.print_comma::<C>(writer_).expect("unreachable");
                        if !self.single_line { let _ = writer_.write_all(b"\n"); }
                    }
                }

                match event_type {
                    EventType::MessageEvent => {
                        if !self.single_line {
                            self.write_indent(writer_).expect("unreachable");
                        }
                        let _ = write!(writer_, "{}data{}:{} ", pf!("<r><blue>"), pf!("<d>"), pf!("<r>"));
                        let data: JSValue = value
                            .fast_get(self.global_this, jsc::BuiltinName::Data)?
                            .unwrap_or(JSValue::UNDEFINED);
                        let tag = Tag::get_advanced(data, self.global_this, self.tag_opts())?;
                        self.format::<C>(tag, writer_, data, self.global_this)?;
                        if self.failed { return Ok(()); }
                        self.print_comma::<C>(writer_).expect("unreachable");
                        if !self.single_line { let _ = writer_.write_all(b"\n"); }
                    }
                    EventType::ErrorEvent => {
                        if let Some(error_value) =
                            value.fast_get(self.global_this, jsc::BuiltinName::Error)?
                        {
                            if !self.single_line {
                                self.write_indent(writer_).expect("unreachable");
                            }
                            let _ = write!(writer_, "{}error{}:{} ", pf!("<r><blue>"), pf!("<d>"), pf!("<r>"));
                            let tag = Tag::get_advanced(error_value, self.global_this, self.tag_opts())?;
                            self.format::<C>(tag, writer_, error_value, self.global_this)?;
                            if self.failed { return Ok(()); }
                            self.print_comma::<C>(writer_).expect("unreachable");
                            if !self.single_line { let _ = writer_.write_all(b"\n"); }
                        }
                    }
                    _ => unreachable!(),
                }
            }

            if !self.single_line {
                self.write_indent(writer_).expect("unreachable");
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        // TODO(port): JSX printing is large (≈230 LOC) and entirely
        // self-contained string formatting over `value.get("type"/"key"/"props"
        // /"children")`. The logic is reproduced here at the same control-flow
        // shape; Phase B must verify against existing JSX snapshot tests
        // (`test/js/bun/util/inspect.test.js`) before trusting the borrow-reseat
        // points.
        fn print_jsx<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            macro_rules! pf { ($s:literal) => { pfmt!($s, C) }; }
            // Cache once: `disable_inspect_custom` does not change inside this
            // function, and `WrappedWriter` holds `&mut self.estimated_line_length`
            // which prevents calling `&self` methods while it is live.
            let tag_opts = self.tag_opts();
            let mut writer = WrappedWriter {
                ctx: writer_, failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };

            writer.write_all(pf!("<r>").as_bytes());
            writer.write_all(b"<");

            let mut needs_space = false;
            let mut tag_name_str = ZigString::init(b"");

            // PORT NOTE: Zig spelled this `ZigString.Slice` with an explicit
            // `defer if (tag_name_slice.isAllocated()) tag_name_slice.deinit()`.
            // The Rust `ZigStringSlice` enum frees on `Drop`, so the scopeguard
            // is unnecessary.
            let mut tag_name_slice = strings::ZigStringSlice::empty();
            let mut is_tag_kind_primitive = false;

            if let Some(type_value) = value.get(self.global_this, "type")? {
                let _tag = Tag::get_advanced(type_value, self.global_this, tag_opts)?;

                if _tag.cell == jsc::JSType::Symbol {
                    // nothing
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
                writer.write_all(pf!("<cyan>").as_bytes());
            } else {
                writer.write_all(pf!("<green>").as_bytes());
            }
            writer.write_all(tag_name_slice.slice());
            if C {
                writer.write_all(pf!("<r>").as_bytes());
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
                    let _qs = defer_restore!(self.quote_strings, old_quote_strings);

                    drop(writer);
                    self.format::<C>(
                        Tag::get_advanced(key_value, self.global_this, self.tag_opts())?,
                        writer_, key_value, self.global_this,
                    )?;
                    writer = WrappedWriter {
                        ctx: writer_, failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };

                    needs_space = true;
                }
            }

            if let Some(props) = value.get(self.global_this, "props")? {
                let prev_quote_strings = self.quote_strings;
                let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
                self.quote_strings = true;

                // SAFETY: JSX props are always objects
                let props_obj = props.get_object().unwrap();
                let mut props_iter = jsc::JSPropertyIterator::init(
                    self.global_this, props_obj,
                    jsc::PropertyIteratorOptions { skip_empty_name: true, include_value: true },
                )?;

                let children_prop = props.get(self.global_this, "children")?;
                if props_iter.len > 0 {
                    {
                        self.indent += 1;
                        let _ind = defer_decrement!(self.indent);
                        let count_without_children =
                            props_iter.len - usize::from(children_prop.is_some());

                        // PORT NOTE: Zig reads `props_iter.i` (the post-yield
                        // counter) directly off the iterator struct. The Rust
                        // `JSPropertyIterator` keeps that field private, so we
                        // mirror it locally — incremented on every successful
                        // yield, exactly as `JSPropertyIterator.zig:next` does.
                        let mut props_i: usize = 0;
                        while let Some(prop) = props_iter.next()? {
                            props_i += 1;
                            if prop.eql_comptime(b"children") {
                                continue;
                            }

                            let property_value = props_iter.value;
                            let tag = Tag::get_advanced(property_value, self.global_this, tag_opts)?;

                            if tag.cell.is_hidden() { continue; }

                            if needs_space { writer.space(); }
                            needs_space = false;

                            // TODO(port): `bun.String.trunc(128)` — `bun_string::String`
                            // has no `trunc` yet. Prop names are short in practice;
                            // print untruncated until the helper lands.
                            writer.print(format_args!(
                                "{}{}{}={}",
                                pf!("<r><blue>"),
                                prop,
                                pf!("<d>"),
                                pf!("<r>")
                            ));

                            if tag.cell.is_string_like() && C {
                                writer.write_all(pfmt!("<r><green>", true).as_bytes());
                            }

                            drop(writer);
                            self.format::<C>(tag, writer_, property_value, self.global_this)?;
                            writer = WrappedWriter {
                                ctx: writer_, failed: false,
                                estimated_line_length: &mut self.estimated_line_length,
                            };

                            if tag.cell.is_string_like() && C {
                                writer.write_all(pfmt!("<r>", true).as_bytes());
                            }

                            if !self.single_line
                                && (
                                    // count_without_children is necessary to prevent
                                    // printing an extra newline if there are children
                                    // and one prop and the child prop is the last prop
                                    props_i + 1 < count_without_children
                                    // 3 is arbitrary but basically
                                    //  <input type="text" value="foo" />
                                    //  ^ should be one line
                                    // <input type="text" value="foo" bar="true" baz={false} />
                                    //  ^ should be multiple lines
                                    && props_i > 3
                                )
                            {
                                writer.write_all(b"\n");
                                write_indent_n(self.indent, writer.ctx).expect("unreachable");
                            } else if props_i + 1 < count_without_children {
                                writer.space();
                            }
                        }
                    }

                    if let Some(children) = children_prop {
                        let tag = Tag::get(children, self.global_this)?;

                        let print_children = matches!(
                            tag.tag.tag(),
                            Tag::String | Tag::JSX | Tag::Array
                        );

                        if print_children && !self.single_line {
                            'print_children: {
                                match tag.tag.tag() {
                                    Tag::String => {
                                        let children_string = children.get_zig_string(self.global_this)?;
                                        if children_string.len == 0 { break 'print_children; }
                                        if C {
                                            writer.write_all(pfmt!("<r>", true).as_bytes());
                                        }
                                        writer.write_all(b">");
                                        if children_string.len < 128 {
                                            writer.write_string(&children_string);
                                        } else {
                                            self.indent += 1;
                                            writer.write_all(b"\n");
                                            write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                            self.indent = self.indent.saturating_sub(1);
                                            writer.write_string(&children_string);
                                            writer.write_all(b"\n");
                                            write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                        }
                                    }
                                    Tag::JSX => {
                                        writer.write_all(b">\n");
                                        {
                                            self.indent += 1;
                                            write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                            let _ind = defer_decrement!(self.indent);
                                            drop(writer);
                                            self.format::<C>(
                                                Tag::get(children, self.global_this)?,
                                                writer_, children, self.global_this,
                                            )?;
                                            writer = WrappedWriter {
                                                ctx: writer_, failed: false,
                                                estimated_line_length: &mut self.estimated_line_length,
                                            };
                                        }
                                        writer.write_all(b"\n");
                                        write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                    }
                                    Tag::Array => {
                                        let length = children.get_length(self.global_this)?;
                                        if length == 0 { break 'print_children; }
                                        writer.write_all(b">\n");
                                        {
                                            self.indent += 1;
                                            write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                            let _prev_quote_strings = self.quote_strings;
                                            self.quote_strings = false;
                                            let _qs2 = defer_restore!(self.quote_strings, _prev_quote_strings);
                                            let _ind = defer_decrement!(self.indent);

                                            let mut j: usize = 0;
                                            while (j as u64) < length {
                                                let child = children.get_index(self.global_this, u32::try_from(j).unwrap())?;
                                                drop(writer);
                                                self.format::<C>(
                                                    Tag::get_advanced(child, self.global_this, self.tag_opts())?,
                                                    writer_, child, self.global_this,
                                                )?;
                                                writer = WrappedWriter {
                                                    ctx: writer_, failed: false,
                                                    estimated_line_length: &mut self.estimated_line_length,
                                                };
                                                if (j as u64) + 1 < length {
                                                    writer.write_all(b"\n");
                                                    write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                                }
                                                j += 1;
                                            }
                                        }
                                        writer.write_all(b"\n");
                                        write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                    }
                                    _ => unreachable!(),
                                }

                                writer.write_all(b"</");
                                if !is_tag_kind_primitive {
                                    writer.write_all(pf!("<r><cyan>").as_bytes());
                                } else {
                                    writer.write_all(pf!("<r><green>").as_bytes());
                                }
                                writer.write_all(tag_name_slice.slice());
                                if C {
                                    writer.write_all(pf!("<r>").as_bytes());
                                }
                                writer.write_all(b">");
                            }

                            return Ok(());
                        }
                    }
                }
            }

            writer.write_all(b" />");
            if writer.failed { self.failed = true; }
            Ok(())
        }

        fn print_object<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            macro_rules! pf { ($s:literal) => { pfmt!($s, C) }; }
            debug_assert!(value.is_cell());
            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            // We want to figure out if we should print this object on one line
            // or multiple lines.
            //
            // The 100% correct way would be to print everything to a temporary
            // buffer and then check how long each line was.
            //
            // But it's important that console.log() is fast. So we do a small
            // compromise to avoid multiple passes over input.
            //
            // We say:
            //
            //   If the object has at least 2 properties and ANY of the
            //   following conditions are met:
            //     - total length of all the property names is more than 14
            //       characters
            //     - the parent object is printing each property on a new line
            //     - The first property is a DOM object, ESM namespace, Map,
            //       Set, or Blob
            //
            //   Then, we print it each property on a new line, recursively.
            let prev_always_newline_scope = self.always_newline_scope;
            let _ans = defer_restore!(self.always_newline_scope, prev_always_newline_scope);
            let mut iter = PropertyIteratorCtx::<C> {
                formatter: self,
                writer: writer_,
                always_newline: !self.single_line
                    && (self.always_newline_scope || self.good_time_for_a_new_line()),
                single_line: self.single_line,
                parent: value,
                i: 0,
            };

            if self.depth > self.max_depth {
                if self.single_line {
                    let _ = writer_.write_all(b" ");
                } else if self.always_newline_scope || self.good_time_for_a_new_line() {
                    let _ = writer_.write_all(b"\n");
                    let _ = self.write_indent(writer_);
                    self.reset_line();
                }

                let mut display_name = value.get_name(self.global_this)?;
                if display_name.is_empty() {
                    display_name = BunString::static_("Object");
                }
                let _ = write!(
                    writer_,
                    "{}[{} ...]{}",
                    pf!("<r><cyan>"),
                    display_name,
                    pf!("<r>")
                );
                return Ok(());
            } else if self.ordered_properties {
                value.for_each_property_ordered(
                    self.global_this,
                    &mut iter as *mut _ as *mut c_void,
                    PropertyIteratorCtx::<C>::for_each,
                )?;
            } else {
                value.for_each_property(
                    self.global_this,
                    &mut iter as *mut _ as *mut c_void,
                    PropertyIteratorCtx::<C>::for_each,
                )?;
            }

            if self.failed {
                return Ok(());
            }

            if iter.i == 0 {
                if value.is_class(self.global_this) {
                    self.print_as::<{ Tag::Class }, C>(writer_, value, js_type)?;
                } else if value.is_callable() {
                    self.print_as::<{ Tag::Function }, C>(writer_, value, js_type)?;
                } else {
                    if let Some(name_str) = get_object_name(self.global_this, value)? {
                        let _ = write!(writer_, "{name_str} ");
                    }
                    let _ = writer_.write_all(b"{}");
                }
            } else {
                self.depth -= 1;

                if iter.always_newline {
                    self.indent = self.indent.saturating_sub(1);
                    self.print_comma::<C>(writer_).expect("unreachable");
                    let _ = writer_.write_all(b"\n");
                    let _ = self.write_indent(writer_);
                    let _ = writer_.write_all(b"}");
                    self.estimated_line_length += 1;
                } else {
                    self.estimated_line_length += 2;
                    let _ = writer_.write_all(b" }");
                }
            }
            Ok(())
        }

        fn print_typed_array<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_, failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let array_buffer = value.as_array_buffer(self.global_this).unwrap();
            let slice = array_buffer.byte_slice();

            if self.format_buffer_as_text
                && js_type == jsc::JSType::Uint8Array
                && bun_string::immutable::is_valid_utf8(slice)
            {
                if C {
                    writer.write_all(pfmt!("<r><green>", true).as_bytes());
                }
                let _ = JSPrinter::write_json_string(slice, writer_, JSPrinter::Encoding::Utf8);
                if C {
                    writer.write_all(pfmt!("<r>", true).as_bytes());
                }
                return Ok(());
            }

            // PORT NOTE: `ArrayBuffer.typed_array_type` is `JSType` in the Rust
            // port (see array_buffer.rs), not the C-API `TypedArrayType` enum.
            writer.write_all(
                if array_buffer.typed_array_type == jsc::JSType::Uint8Array
                    && array_buffer.value.is_buffer(self.global_this)
                {
                    b"Buffer"
                } else if array_buffer.typed_array_type == jsc::JSType::ArrayBuffer
                    && array_buffer.shared
                {
                    b"SharedArrayBuffer"
                } else {
                    typed_array_type_name(array_buffer.typed_array_type)
                },
            );
            if slice.is_empty() {
                writer.print(format_args!("({}) []", array_buffer.len));
                return Ok(());
            }

            writer.print(format_args!("({}) [ ", array_buffer.len));

            use jsc::JSType as T;
            // SAFETY: `slice` comes from a typed array whose backing storage is
            // aligned for its element type.
            macro_rules! cast_slice {
                ($t:ty) => {
                    unsafe {
                        core::slice::from_raw_parts(
                            slice.as_ptr() as *const $t,
                            slice.len() / core::mem::size_of::<$t>(),
                        )
                    }
                };
            }
            match js_type {
                T::Int8Array => self.write_typed_array::<i8, C>(&mut writer, cast_slice!(i8)),
                T::Int16Array => self.write_typed_array::<i16, C>(&mut writer, cast_slice!(i16)),
                T::Uint16Array => self.write_typed_array::<u16, C>(&mut writer, cast_slice!(u16)),
                T::Int32Array => self.write_typed_array::<i32, C>(&mut writer, cast_slice!(i32)),
                T::Uint32Array => self.write_typed_array::<u32, C>(&mut writer, cast_slice!(u32)),
                // TODO(port): Rust has no native f16; use `half::f16` in Phase B.
                T::Float16Array => self.write_typed_array::<bun_core::f16, C>(&mut writer, cast_slice!(bun_core::f16)),
                T::Float32Array => self.write_typed_array::<f32, C>(&mut writer, cast_slice!(f32)),
                T::Float64Array => self.write_typed_array::<f64, C>(&mut writer, cast_slice!(f64)),
                T::BigInt64Array => self.write_typed_array::<i64, C>(&mut writer, cast_slice!(i64)),
                T::BigUint64Array => self.write_typed_array::<u64, C>(&mut writer, cast_slice!(u64)),
                // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
                _ => self.write_typed_array::<u8, C>(&mut writer, slice),
            }

            writer.write_all(b" ]");
            if writer.failed { self.failed = true; }
            Ok(())
        }

        fn write_typed_array<N: TypedArrayElement, const C: bool>(
            &mut self,
            writer: &mut WrappedWriter<'_>,
            slice: &[N],
        ) {
            writer.print(format_args!(
                "{}{}{}{}",
                pfmt!("<r><yellow>", C),
                N::display(slice[0]),
                if N::IS_BIGINT { "n" } else { "" },
                pfmt!("<r>", C),
            ));
            let leftover = &slice[1..];
            const MAX: usize = 512;
            let leftover = &leftover[..leftover.len().min(MAX)];
            for &el in leftover {
                if self.print_comma::<C>(writer.ctx).is_err() {
                    return;
                }
                writer.space();

                writer.print(format_args!(
                    "{}{}{}{}",
                    pfmt!("<r><yellow>", C),
                    N::display(el),
                    if N::IS_BIGINT { "n" } else { "" },
                    pfmt!("<r>", C),
                ));
            }

            if slice.len() > MAX + 1 {
                writer.print(format_args!(
                    "{}{}, ... {} more{}",
                    pfmt!("<r><d>", C),
                    if N::IS_BIGINT { "n" } else { "" },
                    slice.len() - MAX - 1,
                    pfmt!("<r>", C),
                ));
            }
        }

        pub fn format<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            result: TagResult,
            writer: &mut dyn bun_io::Write,
            value: JSValue,
            global_this: &'a JSGlobalObject,
        ) -> JsResult<()> {
            let prev_global_this = self.global_this;
            let _restore = defer_restore!(self.global_this, prev_global_this);
            self.global_this = global_this;

            // This looks incredibly redundant. We make the
            // ConsoleObject.Formatter.Tag a comptime var so we have to repeat
            // it here. The rationale there is it _should_ limit the stack usage
            // because each version of the function will be relatively small.
            macro_rules! dispatch {
                ($($tag:ident),* $(,)?) => {
                    match result.tag.tag() {
                        $( Tag::$tag => self.print_as::<{ Tag::$tag }, ENABLE_ANSI_COLORS>(writer, value, result.cell), )*
                        Tag::CustomFormattedObject => {
                            if let TagPayload::CustomFormattedObject(obj) = result.tag {
                                self.custom_formatted_object = obj;
                            }
                            self.print_as::<{ Tag::CustomFormattedObject }, ENABLE_ANSI_COLORS>(writer, value, result.cell)
                        }
                    }
                };
            }
            dispatch!(
                StringPossiblyFormatted, String, Undefined, Double, Integer, Null, Boolean,
                Array, Object, Function, Class, Error, TypedArray, Map, MapIterator,
                SetIterator, Set, BigInt, Symbol, GlobalObject, Private, Promise, JSON,
                ToJSON, NativeCode, JSX, Event, GetterSetter, CustomGetterSetter, Proxy,
                RevokedProxy,
            )
        }
    }

    /// Abstracts over `{d}` vs `{f}` and `n`-suffix for `write_typed_array`.
    pub trait TypedArrayElement: Copy {
        const IS_BIGINT: bool;
        const IS_FLOAT: bool;
        type Display: core::fmt::Display;
        fn display(self) -> Self::Display;
    }
    macro_rules! int_elem {
        ($($t:ty),*) => { $(
            impl TypedArrayElement for $t {
                const IS_BIGINT: bool = false;
                const IS_FLOAT: bool = false;
                type Display = $t;
                fn display(self) -> Self::Display { self }
            }
        )* };
    }
    int_elem!(u8, i8, u16, i16, u32, i32);
    macro_rules! bigint_elem {
        ($($t:ty),*) => { $(
            impl TypedArrayElement for $t {
                const IS_BIGINT: bool = true;
                const IS_FLOAT: bool = false;
                type Display = $t;
                fn display(self) -> Self::Display { self }
            }
        )* };
    }
    bigint_elem!(u64, i64);
    macro_rules! float_elem {
        ($($t:ty),*) => { $(
            impl TypedArrayElement for $t {
                const IS_BIGINT: bool = false;
                const IS_FLOAT: bool = true;
                type Display = bun_core::fmt::DoubleFormatter;
                fn display(self) -> Self::Display { bun_core::fmt::double(f64::from(self)) }
            }
        )* };
    }
    float_elem!(f32, f64);
    // `bun_core::f16` widens losslessly to `f64` via `From`, so reuse the
    // float printing path. Kept out of the `float_elem!` macro because the
    // macro expands `f64::from(self)` and `f16` is a foreign newtype, not a
    // primitive — but the body is identical.
    impl TypedArrayElement for bun_core::f16 {
        const IS_BIGINT: bool = false;
        const IS_FLOAT: bool = true;
        type Display = bun_core::fmt::DoubleFormatter;
        fn display(self) -> Self::Display { bun_core::fmt::double(f64::from(self)) }
    }

    /// Port of Zig `@tagName(arrayBuffer.typed_array_type)` — `JSType` is a
    /// newtype-const (not a Rust `enum`), so there is no derived stringifier.
    /// Covers every typed-array-ish `JSType` (`isTypedArrayOrArrayBuffer`).
    fn typed_array_type_name(t: jsc::JSType) -> &'static [u8] {
        use jsc::JSType as T;
        match t {
            T::ArrayBuffer => b"ArrayBuffer",
            T::Int8Array => b"Int8Array",
            T::Uint8Array => b"Uint8Array",
            T::Uint8ClampedArray => b"Uint8ClampedArray",
            T::Int16Array => b"Int16Array",
            T::Uint16Array => b"Uint16Array",
            T::Int32Array => b"Int32Array",
            T::Uint32Array => b"Uint32Array",
            T::Float16Array => b"Float16Array",
            T::Float32Array => b"Float32Array",
            T::Float64Array => b"Float64Array",
            T::BigInt64Array => b"BigInt64Array",
            T::BigUint64Array => b"BigUint64Array",
            T::DataView => b"DataView",
            _ => b"TypedArray",
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// C-exported entry points (count / time / etc.)
// ───────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__count(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) {
    // SAFETY: see `vm_console` — single short-lived `&mut` for this entry point.
    let this = unsafe { &mut *vm_console(global_this) };
    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    let hash = bun_wyhash::hash(slice);
    // we don't want to store these strings, it will take too much memory
    let counter = this.counts.get_or_put(hash).expect("unreachable");
    let current: u32 = if counter.found_existing { *counter.value_ptr } else { 0 } + 1;
    *counter.value_ptr = current;

    let writer = this.writer();
    if Output::enable_ansi_colors_stdout() {
        let _ = write!(
            writer,
            "{}{}{}: {}{}{}{}\n",
            pfmt!("<r>", true),
            bstr::BStr::new(slice),
            pfmt!("<d>", true),
            pfmt!("<r><yellow>", true),
            current,
            pfmt!("<r>", true),
            "",
        );
    } else {
        let _ = write!(writer, "{}: {}\n", bstr::BStr::new(slice), current);
    }
    let _ = writer.flush();
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__countReset(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) {
    // SAFETY: see `vm_console` — single short-lived `&mut` for this entry point.
    let this = unsafe { &mut *vm_console(global_this) };
    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    let hash = bun_wyhash::hash(slice);
    // we don't delete it because deleting is implemented via tombstoning
    if let Some(v) = this.counts.get_mut(&hash) {
        *v = 0;
    }
}

type PendingTimers = bun_collections::HashMap<u64, Option<bun_core::time::Timer>>;
thread_local! {
    static PENDING_TIME_LOGS: RefCell<PendingTimers> = RefCell::new(PendingTimers::default());
    static PENDING_TIME_LOGS_LOADED: Cell<bool> = const { Cell::new(false) };
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__time(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    chars: *const u8,
    len: usize,
) {
    // SAFETY: caller passes a valid (ptr, len) pair.
    let id = bun_wyhash::hash(unsafe { core::slice::from_raw_parts(chars, len) });
    if !PENDING_TIME_LOGS_LOADED.with(|c| c.get()) {
        PENDING_TIME_LOGS.with_borrow_mut(|m| *m = PendingTimers::default());
        PENDING_TIME_LOGS_LOADED.with(|c| c.set(true));
    }

    PENDING_TIME_LOGS.with_borrow_mut(|map| {
        let result = map.get_or_put(id).expect("unreachable");
        if !result.found_existing || result.value_ptr.is_none() {
            *result.value_ptr = Some(bun_core::time::Timer::start().expect("unreachable"));
        }
    });
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__timeEnd(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    chars: *const u8,
    len: usize,
) {
    if !PENDING_TIME_LOGS_LOADED.with(|c| c.get()) {
        return;
    }

    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { core::slice::from_raw_parts(chars, len) };
    let id = bun_wyhash::hash(slice);
    // Zig `fetchPut(id, null)` — replace with `None`, returning the previous.
    let Some(prev) = PENDING_TIME_LOGS.with_borrow_mut(|m| {
        m.get_mut(&id).map(|slot| core::mem::replace(slot, None))
    }) else {
        return;
    };
    let Some(value) = prev else { return };
    // get the duration in microseconds, then display it in milliseconds
    Output::print_elapsed(
        (value.read() / bun_core::time::NS_PER_US) as f64 / bun_core::time::US_PER_MS as f64,
    );
    match len {
        0 => Output::print_errorln(format_args!("\n")),
        _ => Output::print_errorln(format_args!(" {}", bstr::BStr::new(slice))),
    }

    Output::flush();
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__timeLog(
    _console: *mut ConsoleObject,
    global: &JSGlobalObject,
    chars: *const u8,
    len: usize,
    args: *const JSValue,
    args_len: usize,
) {
    if !PENDING_TIME_LOGS_LOADED.with(|c| c.get()) {
        return;
    }

    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { core::slice::from_raw_parts(chars, len) };
    let id = bun_wyhash::hash(slice);
    let Some(Some(value)) = PENDING_TIME_LOGS.with_borrow(|m| m.get(&id).copied()) else {
        return;
    };
    // get the duration in microseconds, then display it in milliseconds
    Output::print_elapsed(
        (value.read() / bun_core::time::NS_PER_US) as f64 / bun_core::time::US_PER_MS as f64,
    );
    match len {
        0 => {}
        _ => Output::print_error(format_args!(" {}", bstr::BStr::new(slice))),
    }
    Output::flush();

    // print the arguments
    // PORT NOTE: `Formatter` has a `Drop` impl, so struct-update from a
    // temporary is rejected (E0509). Construct via `new()` then mutate.
    let mut fmt = Formatter::new(global);
    // TODO(port-cycle): `CLI::get().runtime_options.console_depth` — see
    // the matching note in `message_with_type_and_level_`.
    fmt.max_depth = DEFAULT_CONSOLE_LOG_DEPTH;
    fmt.stack_check = StackCheck::init();
    fmt.can_throw_stack_overflow = true;
    // SAFETY: see `vm_console` — single short-lived `&mut` for this entry point.
    let console = unsafe { &mut *vm_console(global) };
    let mut writer = IoWriterAdapter(console.error_writer());
    // SAFETY: caller passes a valid (args, args_len) pair.
    for &arg in unsafe { core::slice::from_raw_parts(args, args_len) } {
        let Ok(tag) = formatter::Tag::get(arg, global) else { return };
        let _ = bun_io::Write::write_all(&mut writer, b" ");
        if Output::enable_ansi_colors_stderr() {
            let _ = fmt.format::<true>(tag, &mut writer, arg, global);
        } else {
            let _ = fmt.format::<false>(tag, &mut writer, arg, global);
        }
    }
    let _ = bun_io::Write::write_all(&mut writer, b"\n");
    let _ = bun_io::Write::flush(&mut writer);
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__profile(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__profileEnd(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__takeHeapSnapshot(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
    // TODO: this does an extra JSONStringify and we don't need it to!
    // PORT NOTE: `JSGlobalObject::generate_heap_snapshot` lives in the gated
    // `JSGlobalObject.rs` impl block (`#![cfg(any())]`), so call the FFI
    // export directly until that module un-gates.
    extern "C" {
        fn JSC__JSGlobalObject__generateHeapSnapshot(this: *const JSGlobalObject) -> JSValue;
    }
    // SAFETY: `global_this` is a live `JSGlobalObject*`; C++ side has no extra
    // preconditions.
    let snapshot: [JSValue; 1] =
        [unsafe { JSC__JSGlobalObject__generateHeapSnapshot(global_this) }];
    // SAFETY: re-entry into our own host shim with a stack-local args slice.
    unsafe {
        message_with_type_and_level(
            core::ptr::null_mut(), // Zig passes `undefined` here
            MessageType::Log,
            MessageLevel::Debug,
            global_this,
            snapshot.as_ptr(),
            1,
        );
    }
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__timeStamp(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__record(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__recordEnd(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__screenshot(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__messageWithTypeAndLevel(
    ctype: *mut ConsoleObject,
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) {
    // SAFETY: forwarding the same FFI args to the inner host shim.
    unsafe { message_with_type_and_level(ctype, message_type, level, global, vals, len) };
}


// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ConsoleObject.zig (3833 lines)
//   confidence: low
//   todos:      15
//   notes:      Heavy borrowck reshaping around WrappedWriter (borrows self.estimated_line_length); print_as arms hoisted to helpers; pfmt! assumed macro; self-ref writer fields restructured as getters per LIFETIMES.tsv; const-generic Tag dispatch needs ConstParamTy; f16 path stubbed. WrappedWriter kept dyn (PERF-tagged) — generic cascade touches iterator ctxs.
// ──────────────────────────────────────────────────────────────────────────
