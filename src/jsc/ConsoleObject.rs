//! Implements `console.*` printing for the Bun runtime: type-tag dispatch,
//! recursive value formatting, table printing, `%`-format specifier handling,
//! `console.count`/`time`/`timeEnd`, and the C ABI shims that JavaScriptCore
//! calls into.

use crate::ComptimeStringMapExt as _;
use core::cell::{Cell, RefCell};
use core::ffi::c_void;

use crate as jsc;
use crate::virtual_machine::VirtualMachine;
use crate::{EventType, JSGlobalObject, JSPromise, JSValue, JsResult};
use bun_collections::HashMap;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_core::{Output, StackCheck};

/// Thin facade over `bun_js_parser::lexer` / `bun_js_printer` so the call
/// sites below can use the `JSLexer.isLatin1Identifier` /
/// `JSPrinter.writeJsonString` spelling while the underlying crates expose
/// slightly different shapes (single generic identifier predicate; const-generic
/// encoding on `write_json_string`).
mod JSLexer {
    #[inline]
    pub(super) fn is_latin1_identifier_u8(name: &[u8]) -> bool {
        bun_ast::lexer_tables::is_latin1_identifier(name)
    }
    /// Same predicate over a UTF-16 slice. Canonical impl lives next to the u8 overload in
    /// `bun_js_parser::lexer`.
    #[inline]
    pub(super) fn is_latin1_identifier_u16(name: &[u16]) -> bool {
        bun_ast::lexer_tables::is_latin1_identifier_u16(name)
    }
}
mod JSPrinter {
    pub(super) use bun_js_printer::Encoding;
    /// Runtime-encoding adapter over `bun_js_printer::write_json_string`,
    /// which takes `Encoding` as a const generic.
    #[inline]
    pub(super) fn write_json_string(
        input: &[u8],
        writer: &mut (impl bun_io::Write + ?Sized),
        encoding: Encoding,
    ) -> bun_js_printer::Result<()> {
        match encoding {
            Encoding::Latin1 => {
                bun_js_printer::write_json_string::<_, { Encoding::Latin1 }>(input, writer)
            }
            Encoding::Utf8 => {
                bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(input, writer)
            }
            Encoding::Ascii => {
                bun_js_printer::write_json_string::<_, { Encoding::Ascii }>(input, writer)
            }
            Encoding::Utf16 => {
                bun_js_printer::write_json_string::<_, { Encoding::Utf16 }>(input, writer)
            }
        }
    }
}

/// Local front for `bun_core::pretty_fmt!` that accepts a runtime / const-
/// generic bool. The macro only matches `true`/`false` literals, so
/// monomorphized callers (`<const C: bool>`) branch here.
// Both arms are `&'static str`.
macro_rules! pfmt {
    ($fmt:expr, $colors:expr) => {
        if $colors {
            ::bun_core::pretty_fmt!($fmt, true)
        } else {
            ::bun_core::pretty_fmt!($fmt, false)
        }
    };
}

// ───────────────────────────────────────────────────────────────────────────
// ConsoleObject
// ───────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `Inspector::ScriptArguments`.
    pub struct ScriptArguments;
}

/// Default depth for `console.log` object inspection.
/// Only `--console-depth` CLI flag and `console.depth` bunfig option should modify this.
const DEFAULT_CONSOLE_LOG_DEPTH: u16 = 2;

type Counter = HashMap<u64, u32>;

pub struct ConsoleObject {
    stderr_buffer: [u8; 4096],
    stdout_buffer: [u8; 4096],

    error_writer_backing: Output::QuietWriterAdapter,
    writer_backing: Output::QuietWriterAdapter,

    pub(crate) default_indent: u16,

    counts: Counter,

    // The writer adapters above hold raw pointers into `{stderr,stdout}_buffer`;
    // moving the struct would dangle them, so opt out of `Unpin`.
    _pin: core::marker::PhantomPinned,
}

impl core::fmt::Display for ConsoleObject {
    fn fmt(&self, _: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Intentionally prints nothing.
        Ok(())
    }
}

impl ConsoleObject {
    /// Boxed because the writer adapters point into the buffer fields: the
    /// value is self-referential and must stay at this address (the VM keeps
    /// the box for its whole life and never moves out of it).
    pub(crate) fn new(
        error_writer: Output::StreamType,
        writer: Output::StreamType,
    ) -> Box<ConsoleObject> {
        let mut out = Box::new(ConsoleObject {
            stderr_buffer: [0; 4096],
            stdout_buffer: [0; 4096],
            error_writer_backing: Output::QuietWriterAdapter::uninit(),
            writer_backing: Output::QuietWriterAdapter::uninit(),
            default_indent: 0,
            counts: Counter::default(),
            _pin: core::marker::PhantomPinned,
        });
        let this = &mut *out;
        this.error_writer_backing = error_writer
            .quiet_writer()
            .adapt_to_new_api(&mut this.stderr_buffer);
        this.writer_backing = writer
            .quiet_writer()
            .adapt_to_new_api(&mut this.stdout_buffer);
        out
    }

    /// The `void*` handed to the C++ `ConsoleObject` client, which passes it
    /// back (unused) as the first argument of every `Bun__ConsoleObject__*`.
    #[inline]
    pub(crate) fn as_cpp_ptr(&mut self) -> *mut c_void {
        core::ptr::from_mut(self).cast()
    }

    /// Returns the buffered stderr writer interface.
    #[inline]
    pub(crate) fn error_writer(&mut self) -> &mut bun_core::io::Writer {
        self.error_writer_backing.new_interface()
    }

    /// Returns the buffered stdout writer interface.
    #[inline]
    pub(crate) fn writer(&mut self) -> &mut bun_core::io::Writer {
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
}

impl MessageLevel {
    /// The wire value is an arbitrary `u32`, not guaranteed in range. Taking
    /// the exhaustive Rust enum directly across the C ABI would be instant UB
    /// if JSC ever passes an out-of-range discriminant, so the
    /// `Bun__ConsoleObject__messageWithTypeAndLevel` shim accepts a raw `u32`
    /// and routes through here. Unknown values fold to `Log` — nothing
    /// branches on the unknown case, so the clamp is behavior-preserving.
    #[inline]
    pub(crate) const fn from_raw(raw: u32) -> Self {
        match raw {
            0 => Self::Log,
            1 => Self::Warning,
            2 => Self::Error,
            3 => Self::Debug,
            4 => Self::Info,
            _ => Self::Log,
        }
    }
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

impl MessageType {
    /// See [`MessageLevel::from_raw`] — the wire value is an arbitrary `u32`;
    /// fold unknown discriminants to `Log` so the
    /// FFI boundary never constructs an invalid enum value.
    #[inline]
    pub(crate) const fn from_raw(raw: u32) -> Self {
        match raw {
            0 => Self::Log,
            1 => Self::Dir,
            2 => Self::DirXML,
            3 => Self::Table,
            4 => Self::Trace,
            5 => Self::StartGroup,
            6 => Self::StartGroupCollapsed,
            7 => Self::EndGroup,
            8 => Self::Clear,
            9 => Self::Assert,
            10 => Self::Timing,
            11 => Self::Profile,
            12 => Self::ProfileEnd,
            13 => Self::Image,
            _ => Self::Log,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Body — format2 / TablePrinter / Formatter::print_as / C-exported
// Bun__ConsoleObject__* shims.
// ───────────────────────────────────────────────────────────────────────────

use bun_threading::Mutex;

/// `globalThis.bunVM().console`, for one short read or update. Every
/// `Bun__ConsoleObject__*` entry point is a top-level JS-thread host call.
#[inline]
fn with_console<R>(global: &JSGlobalObject, f: impl FnOnce(&mut ConsoleObject) -> R) -> R {
    f(global.bun_vm().as_mut().console_mut())
}

/// The VM console's buffered stdout/stderr writer. Formatting through it runs
/// user JS, which may re-enter `console.*` and write through the same stream.
#[inline]
fn console_writer(global: &JSGlobalObject, stderr: bool) -> &mut bun_core::io::Writer {
    let console = global.bun_vm().as_mut().console_mut();
    if stderr {
        console.error_writer()
    } else {
        console.writer()
    }
}

static STDERR_MUTEX: Mutex = Mutex::new();
static STDOUT_MUTEX: Mutex = Mutex::new();

thread_local! {
    static STDERR_LOCK_COUNT: Cell<u16> = const { Cell::new(0) };
    static STDOUT_LOCK_COUNT: Cell<u16> = const { Cell::new(0) };
}

/// RAII guard for the per-stream reentrant console lock. Acquires on
/// construction (incrementing the thread-local count and locking the global
/// mutex on first entry), releases on `Drop` (decrementing and unlocking on
/// last exit).
struct ConsoleStreamLock {
    use_stderr: bool,
}

impl ConsoleStreamLock {
    fn acquire(use_stderr: bool) -> Self {
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
        Self { use_stderr }
    }
}

impl Drop for ConsoleStreamLock {
    fn drop(&mut self) {
        if self.use_stderr {
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
    }
}

/// RAII flush of a borrowed `bun_io::Write` at scope exit when `enabled`.
///
/// Owns the `&mut dyn Write` for its lifetime; the body of the scope must
/// reborrow through `&mut *guard.writer` so that all body accesses are
/// children of the guard's borrow under Stacked Borrows. Coercing to a raw
/// pointer here while the body kept using the parent `&mut` would invalidate
/// the raw pointer's tag before `Drop` runs.
struct FlushOnDrop<'a> {
    writer: &'a mut (dyn bun_io::Write + 'a),
    enabled: bool,
}

impl Drop for FlushOnDrop<'_> {
    #[inline]
    fn drop(&mut self) {
        if self.enabled {
            let _ = self.writer.flush();
        }
    }
}

/// <https://console.spec.whatwg.org/#formatter>
pub fn message_with_type_and_level(
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: &[JSValue],
) {
    if let Err(err) = message_with_type_and_level_(message_type, level, global, vals) {
        // The exception is already set on the VM (`JsError::Thrown`); for OOM
        // make sure something is pending. Mirrors `host_fn::void_from_js_error`.
        if matches!(err, jsc::JsError::OutOfMemory) {
            global.throw_out_of_memory_value();
        }
        debug_assert!(global.has_exception());
    }
}

fn message_with_type_and_level_(
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals_slice: &[JSValue],
) -> JsResult<()> {
    let len = vals_slice.len();
    // `defer console.default_indent +|= (message_type == StartGroup) as u16;`
    let is_start_group = message_type == MessageType::StartGroup;
    let _indent_guard = scopeguard::guard(global, move |global| {
        with_console(global, |console| {
            console.default_indent = console.default_indent.saturating_add(is_start_group as u16)
        });
    });

    if message_type == MessageType::StartGroup && len == 0 {
        // undefined is printed if passed explicitly.
        return Ok(());
    }

    if message_type == MessageType::EndGroup {
        with_console(global, |c| {
            c.default_indent = c.default_indent.saturating_sub(1)
        });
        return Ok(());
    }

    // Lock/unlock a mutex incase two JS threads are console.log'ing at the same
    // time. We do this the slightly annoying way to avoid assigning a pointer.
    let use_stderr = matches!(level, MessageLevel::Warning | MessageLevel::Error)
        || message_type == MessageType::Assert;
    let _stream_lock = ConsoleStreamLock::acquire(use_stderr);

    if message_type == MessageType::Clear {
        Output::reset_terminal();
        return Ok(());
    }

    if message_type == MessageType::Assert && len == 0 {
        let text: &str = if Output::enable_ansi_colors_stderr() {
            pfmt!("<r><red>Assertion failed<r>\n", true)
        } else {
            "Assertion failed\n"
        };
        let ew = console_writer(global, true);
        let _ = ew.write_all(text.as_bytes());
        let _ = ew.flush();
        return Ok(());
    }

    let enable_colors = if matches!(level, MessageLevel::Warning | MessageLevel::Error) {
        Output::enable_ansi_colors_stderr()
    } else {
        Output::enable_ansi_colors_stdout()
    };

    // Snapshot before borrowing the writer; `default_indent` is not mutated
    // again until the deferred `_indent_guard` runs on scope exit, so the two
    // later reads (FormatOptions / TablePrinter) use this cached copy.
    let default_indent = with_console(global, |c| c.default_indent);

    let raw_writer: &mut bun_core::io::Writer = console_writer(
        global,
        matches!(level, MessageLevel::Warning | MessageLevel::Error),
    );
    // `bun_core::io::Writer: bun_io::Write` — `&mut Writer` unsize-coerces directly.
    let writer: &mut dyn bun_io::Write = raw_writer;

    // LAYERING: `Jest::runner()` lives in `bun_runtime::test_runner` (forward
    // dep on the high tier). Dispatch through `RuntimeHooks` instead — the
    // high-tier hook checks `Jest.runner` and calls `onBeforePrint()`; no-op
    // when `bun test` isn't running or hooks aren't installed.
    if let Some(hooks) = crate::virtual_machine::runtime_hooks() {
        (hooks.console_on_before_print)();
    }

    let mut print_length = len;
    // Get console depth from CLI options or bunfig, fallback to default.
    let console_depth = bun_options_types::context::try_get()
        .and_then(|ctx| ctx.runtime_options.console_depth)
        .unwrap_or(DEFAULT_CONSOLE_LOG_DEPTH);

    let mut print_options = FormatOptions {
        enable_colors,
        add_newline: true,
        flush: true,
        default_indent,
        max_depth: console_depth,
        error_display_level: match level {
            MessageLevel::Error => ErrorDisplayLevel::Full,
            MessageLevel::Warning => ErrorDisplayLevel::Warn,
            _ => ErrorDisplayLevel::Normal,
        },
        ..FormatOptions::default()
    };

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
            table_printer.value_formatter.indent += u32::from(default_indent);

            if enable_colors {
                let _ = table_printer.print_table::<true>(writer);
            } else {
                let _ = table_printer.print_table::<false>(writer);
            }
            let _ = writer.flush();
            return Ok(());
        }
    }

    if message_type == MessageType::Dir && len >= 2 {
        print_length = 1;
        let opts = vals_slice[1];
        if opts.is_object() {
            if let Some(depth_prop) = opts.get(global, b"depth")? {
                if depth_prop.is_int32() || depth_prop.is_number() || depth_prop.is_big_int() {
                    // Clamp negatives to 0, then truncate (not saturate) to u16.
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
        format2(
            level,
            global,
            &vals_slice[..print_length],
            writer,
            print_options,
        )?;
    } else if message_type == MessageType::Log {
        // `writer` (above) is dead in this arm — the only later uses are in
        // the mutually-exclusive `Trace` block, and `message_type == Log` here.
        let w = console_writer(global, false);
        let _ = w.write_all(b"\n");
        let _ = w.flush();
    } else if message_type != MessageType::Trace {
        let _ = writer.write_all(b"undefined\n");
    }

    if message_type == MessageType::Trace {
        write_trace(writer, global);
        let _ = writer.flush();
    }

    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// TablePrinter
// ───────────────────────────────────────────────────────────────────────────

pub struct TablePrinter<'a> {
    global_object: &'a JSGlobalObject,
    /// Per-cell value formatter. Public so callers (e.g. `Bun.inspect.table`)
    /// can override `depth` / `ordered_properties` / `single_line` after init.
    pub value_formatter: Formatter<'a>,

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

enum RowKey {
    /// Property-name UTF-8 bytes + visible width (plain-object tabular data).
    Str {
        text: bun_core::Utf8Bytes<'static>,
        width: u32,
    },
    /// Row index (array / iterable tabular data). Rendered on demand.
    Num(u32),
}

impl RowKey {
    fn str(name: &bun_core::StringView) -> Self {
        Self::Str {
            width: u32::try_from(name.visible_width_exclude_ansi_colors(false)).expect("int cast"),
            text: (**name).clone().into_utf8(),
        }
    }

    fn width(&self) -> u32 {
        match self {
            RowKey::Str { width, .. } => *width,
            RowKey::Num(value) => bun_core::fmt::digit_count(*value) as u32,
        }
    }
}

/// One formatted cell: the byte range of its rendered text in the shared
/// `cell_text` scratch buffer, plus that text's visible terminal width.
#[derive(Clone, Copy)]
struct CellRef {
    /// Byte offset into `cell_text`.
    offset: usize,
    /// Byte length in `cell_text`.
    len: usize,
    /// Visible width of the text, excluding ANSI escape sequences.
    width: u32,
}

impl CellRef {
    fn text<'t>(&self, cell_text: &'t [u8]) -> &'t [u8] {
        &cell_text[self.offset..self.offset + self.len]
    }
}

/// One table row, collected during the width pass so the render pass never
/// re-reads a property (which would re-invoke its getter) and never
/// re-formats a value (which would re-run a custom inspect hook).
struct CollectedRow {
    key: RowKey,
    /// Indexed by `column_index - 1`. `None` is an absent cell. May be
    /// shorter than `columns.len() - 1` when later rows added columns this
    /// row lacks.
    cells: Vec<Option<CellRef>>,
    /// Cell routed to the trailing "Values" column (primitives, Map values).
    values_cell: Option<CellRef>,
}

const PADDING: u32 = 1;

impl<'a> TablePrinter<'a> {
    pub fn init(
        global_object: &'a JSGlobalObject,
        level: MessageLevel,
        tabular_data: JSValue,
        properties: JSValue,
    ) -> JsResult<Self> {
        let _ = level;
        Ok(TablePrinter {
            global_object,
            tabular_data,
            properties,
            is_iterable: tabular_data.is_iterable(global_object)?,
            jstype: tabular_data.js_type(),
            value_formatter: {
                // `Formatter` has a `Drop` impl, so struct-update
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

    /// Format `value` exactly once (bare for strings, quoted otherwise),
    /// appending its rendered bytes to the shared `cell_text` scratch, and
    /// return the recorded byte range plus its visible width.
    fn format_cell<const ENABLE_ANSI_COLORS: bool>(
        &self,
        cell_text: &mut Vec<u8>,
        value: JSValue,
    ) -> JsResult<CellRef> {
        let offset = cell_text.len();
        let mut value_formatter = self.value_formatter.shallow_clone();
        let tag = formatter::Tag::get(value, self.global_object)?;
        value_formatter.quote_strings = !(matches!(
            tag.tag,
            TagPayload::String | TagPayload::StringPossiblyFormatted
        ));
        value_formatter.format::<ENABLE_ANSI_COLORS>(tag, cell_text, value, self.global_object)?;

        let text = &cell_text[offset..];
        Ok(CellRef {
            offset,
            len: text.len(),
            width: strings::visible::width::exclude_ansi_colors::utf8(text) as u32,
        })
    }

    /// Read and format the row's cell values exactly once, size the columns
    /// (creating them on demand), and return the collected row for the
    /// render pass.
    fn collect_row<const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        cell_text: &mut Vec<u8>,
        columns: &mut Vec<Column>,
        row_key: RowKey,
        row_value: JSValue,
    ) -> JsResult<CollectedRow> {
        columns[0].width = columns[0].width.max(row_key.width());

        let mut row = CollectedRow {
            key: row_key,
            cells: Vec::new(),
            values_cell: None,
        };

        // special handling for Map: column with idx=1 is "Keys"
        if self.jstype.is_map() {
            let key_cell = self.format_cell::<ENABLE_ANSI_COLORS>(
                cell_text,
                row_value.get_index(self.global_object, 0)?,
            )?;
            let value_cell = self.format_cell::<ENABLE_ANSI_COLORS>(
                cell_text,
                row_value.get_index(self.global_object, 1)?,
            )?;
            columns[1].width = columns[1].width.max(key_cell.width);
            self.values_col_width = Some(self.values_col_width.unwrap_or(0).max(value_cell.width));
            row.cells.push(Some(key_cell));
            row.values_cell = Some(value_cell);
            return Ok(row);
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
                        let cell = self.format_cell::<ENABLE_ANSI_COLORS>(cell_text, value)?;
                        column.width = column.width.max(cell.width);
                        row.cells.push(Some(cell));
                    } else {
                        row.cells.push(None);
                    }
                }
            } else {
                let cols_iter = jsc::JSPropertyIterator::init(
                    self.global_object,
                    obj,
                    jsc::PropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                    },
                )?;

                while let Some((col_key, value)) = cols_iter.next()? {
                    // find or create the column for the property
                    let col_idx: usize = 'brk: {
                        // reshaped for borrowck — split find/append.
                        if let Some(idx) =
                            columns[1..].iter().position(|col| col.name.eql(&col_key))
                        {
                            break 'brk 1 + idx;
                        }

                        columns.push(Column {
                            name: (*col_key).clone(),
                            width: 1,
                        });
                        break 'brk columns.len() - 1;
                    };

                    let cell = self.format_cell::<ENABLE_ANSI_COLORS>(cell_text, value)?;
                    columns[col_idx].width = columns[col_idx].width.max(cell.width);
                    let slot = col_idx - 1;
                    if row.cells.len() <= slot {
                        row.cells.resize(slot + 1, None);
                    }
                    row.cells[slot] = Some(cell);
                }
            }
        } else if self.properties.is_undefined() {
            // not object -> the value will go to the special "Values" column
            let cell = self.format_cell::<ENABLE_ANSI_COLORS>(cell_text, row_value)?;
            self.values_col_width = Some(self.values_col_width.unwrap_or(1).max(cell.width));
            row.values_cell = Some(cell);
        }
        Ok(row)
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

    fn print_row(
        &self,
        writer: &mut dyn bun_io::Write,
        columns: &[Column],
        row: &CollectedRow,
        cell_text: &[u8],
    ) {
        let _ = writer.write_all("│".as_bytes());
        {
            let needed = columns[0].width.saturating_sub(row.key.width());

            // Right-align the number column
            let _ = writer.splat_byte_all(b' ', (needed + PADDING) as usize);
            match &row.key {
                RowKey::Str { text, .. } => {
                    let _ = writer.write_all(text.slice());
                }
                RowKey::Num(value) => {
                    let _ = write!(writer, "{value}");
                }
            }
            let _ = writer.splat_byte_all(b' ', PADDING as usize);
        }

        for col_idx in 1..columns.len() {
            let col = &columns[col_idx];

            let _ = writer.write_all("│".as_bytes());

            let cell = if col_idx == self.values_col_idx {
                row.values_cell
            } else {
                row.cells.get(col_idx - 1).copied().flatten()
            };

            match cell {
                None => {
                    let _ = writer.splat_byte_all(b' ', (col.width + PADDING * 2) as usize);
                }
                Some(cell) => {
                    let needed = col.width.saturating_sub(cell.width);
                    let _ = writer.splat_byte_all(b' ', PADDING as usize);
                    let _ = writer.write_all(cell.text(cell_text));
                    let _ = writer.splat_byte_all(b' ', (needed + PADDING) as usize);
                }
            }
        }
        let _ = writer.write_all("│\n".as_bytes());
    }

    pub fn print_table<const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut dyn bun_io::Write,
    ) -> JsResult<()> {
        let global_object = self.global_object;

        let mut columns: Vec<Column> = Vec::with_capacity(16);

        // create the first column " " which is always present
        columns.push(Column {
            name: BunString::static_("\u{0020}"),
            width: 1,
        });

        // special case for Map: create the special "Key" column at index 1
        if self.jstype.is_map() {
            columns.push(Column {
                name: BunString::static_("Key"),
                width: 1,
            });
        }

        // if the "properties" arg was provided, pre-populate the columns
        if !self.properties.is_undefined() {
            let mut properties_iter = jsc::JSArrayIterator::init(self.properties, global_object)?;
            while let Some(value) = properties_iter.next()? {
                columns.push(Column {
                    name: value.to_bun_string(global_object)?,
                    width: 1,
                });
            }
        }

        // Width pass: format each cell exactly once, appending its bytes to
        // `cell_text` and sizing columns. The render pass replays those byte
        // ranges, so no property is re-read and no value is re-formatted.
        let mut cell_text: Vec<u8> = Vec::new();
        let mut rows: Vec<CollectedRow> = Vec::new();
        {
            if self.is_iterable {
                struct Ctx<'c, 'a, const C: bool> {
                    this: &'c mut TablePrinter<'a>,
                    cell_text: &'c mut Vec<u8>,
                    columns: &'c mut Vec<Column>,
                    rows: &'c mut Vec<CollectedRow>,
                    idx: u32,
                    err: Option<jsc::JsError>,
                }
                // Capture before constructing `ctx` (which mutably borrows `*self`).
                let tabular_data = self.tabular_data;
                let mut ctx = Ctx::<'_, '_, ENABLE_ANSI_COLORS> {
                    this: self,
                    cell_text: &mut cell_text,
                    columns: &mut columns,
                    rows: &mut rows,
                    idx: 0,
                    err: None,
                };
                impl<const C: bool> jsc::ForEachContext for Ctx<'_, '_, C> {
                    fn on_value(&mut self, _: &JSGlobalObject, value: JSValue) {
                        // Once a cell failed, a JS exception may be pending (or
                        // the VM terminating); don't re-enter user code for the
                        // remaining elements.
                        if self.err.is_some() {
                            return;
                        }
                        match self.this.collect_row::<C>(
                            self.cell_text,
                            self.columns,
                            RowKey::Num(self.idx),
                            value,
                        ) {
                            Ok(row) => self.rows.push(row),
                            Err(err) => self.err = Some(err),
                        }
                        self.idx += 1;
                    }
                }
                tabular_data.for_each_ctx(global_object, &mut ctx)?;
                if let Some(err) = ctx.err {
                    return Err(err);
                }
            } else {
                let tabular_obj = self.tabular_data.to_object(global_object)?;
                let rows_iter = jsc::JSPropertyIterator::init(
                    global_object,
                    tabular_obj,
                    jsc::PropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                    },
                )?;

                while let Some((row_key, value)) = rows_iter.next()? {
                    let key = RowKey::str(&row_key);
                    let row = self.collect_row::<ENABLE_ANSI_COLORS>(
                        &mut cell_text,
                        &mut columns,
                        key,
                        value,
                    )?;
                    rows.push(row);
                }
            }
        }

        // append the special "Values" column as the last one, if it is present
        if let Some(width) = self.values_col_width {
            self.values_col_idx = columns.len();
            columns.push(Column {
                name: BunString::static_("Values"),
                width,
            });
        }

        // print the table header (border line + column names line + border line)
        {
            for col in columns.iter_mut() {
                // also update the col width with the length of the column name itself
                col.width = col.width.max(
                    u32::try_from(col.name.visible_width_exclude_ansi_colors(false))
                        .expect("int cast"),
                );
            }

            let _ = writer.write_all("┌".as_bytes());
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    let _ = writer.write_all("┬".as_bytes());
                }
                let _ = Self::write_string_n_times(
                    writer,
                    "─".as_bytes(),
                    (col.width + PADDING * 2) as usize,
                );
            }

            let _ = writer.write_all("┐\n│".as_bytes());

            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    let _ = writer.write_all("│".as_bytes());
                }
                let len = col.name.visible_width_exclude_ansi_colors(false);
                let needed = (col.width as usize).saturating_sub(len);
                let _ = writer.splat_byte_all(b' ', 1);
                if ENABLE_ANSI_COLORS {
                    let _ = writer.write_all(pfmt!("<r><b>", true).as_bytes());
                }
                let _ = write!(writer, "{}", col.name);
                if ENABLE_ANSI_COLORS {
                    let _ = writer.write_all(pfmt!("<r>", true).as_bytes());
                }
                let _ = writer.splat_byte_all(b' ', needed + PADDING as usize);
            }

            let _ = writer.write_all("│\n├".as_bytes());
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    let _ = writer.write_all("┼".as_bytes());
                }
                let _ = Self::write_string_n_times(
                    writer,
                    "─".as_bytes(),
                    (col.width + PADDING * 2) as usize,
                );
            }
            let _ = writer.write_all("┤\n".as_bytes());
        }

        // render pass: replay each row's pre-formatted cell bytes
        for row in rows.iter() {
            self.print_row(writer, &columns, row, &cell_text);
        }

        // print the table bottom border
        {
            let _ = writer.write_all("└".as_bytes());
            let _ = Self::write_string_n_times(
                writer,
                "─".as_bytes(),
                (columns[0].width + PADDING * 2) as usize,
            );
            for column in columns[1..].iter() {
                let _ = writer.write_all("┴".as_bytes());
                let _ = Self::write_string_n_times(
                    writer,
                    "─".as_bytes(),
                    (column.width + PADDING * 2) as usize,
                );
            }
            let _ = writer.write_all("┘\n".as_bytes());
        }

        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// writeTrace
// ───────────────────────────────────────────────────────────────────────────

pub fn write_trace(writer: &mut dyn bun_io::Write, global: &JSGlobalObject) {
    let mut holder = crate::zig_exception::Holder::init();
    let vm = VirtualMachine::get().as_mut();

    let mut source_code_slice: Option<bun_core::Utf8Bytes> = None;

    let err = global.create_error_instance(format_args!("trace output"));
    // `remap_zig_exception` populates `holder.zig_exception()` from `err`.
    // `exception` and `&holder.need_to_clear_parser_arena_on_deinit` would be
    // two simultaneous `&mut` into `holder`. Capture the flag in a local and
    // write it back after.
    let mut need_to_clear = holder.need_to_clear_parser_arena_on_deinit;
    vm.remap_zig_exception(
        holder.zig_exception(),
        err,
        None,
        &mut need_to_clear,
        &mut source_code_slice,
        false,
    );
    holder.need_to_clear_parser_arena_on_deinit = need_to_clear;

    let mut adapter = bun_io::IoWriterAdapter::new(writer);
    let _ = VirtualMachine::print_stack_trace(
        adapter.interface(),
        &holder.zig_exception().stack,
        Output::enable_ansi_colors_stderr(),
    );

    drop(source_code_slice);
    holder.deinit(vm);
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

pub struct ErrorDisplayLevelFormatter<'a> {
    pub name: &'a BunString,
    pub(crate) level: ErrorDisplayLevel,
    pub(crate) enable_colors: bool,
    pub(crate) colon: Colon,
}

impl core::fmt::Display for ErrorDisplayLevelFormatter<'_> {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.enable_colors {
            match self.level {
                ErrorDisplayLevel::Normal => writer.write_str(pfmt!("<r>", true))?,
                ErrorDisplayLevel::Warn => writer.write_str(pfmt!("<r><yellow>", true))?,
                ErrorDisplayLevel::Full => writer.write_str(pfmt!("<r><red>", true))?,
            }
        }

        if !self.name.is_empty() {
            core::fmt::Display::fmt(self.name, writer)?;
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
    pub(crate) fn formatter(
        self,
        error_name: &BunString,
        enable_colors: bool,
        colon: Colon,
    ) -> ErrorDisplayLevelFormatter<'_> {
        ErrorDisplayLevelFormatter {
            name: error_name,
            level: self,
            enable_colors,
            colon,
        }
    }
}

impl FormatOptions {
    pub fn from_js(&mut self, global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<()> {
        let arg1 = arguments[0];

        if arg1.is_object() {
            if let Some(opt) = arg1.get_truthy(global_this, "depth")? {
                self.set_depth(global_this, opt)?;
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
                self.set_depth(global_this, arg1)?;
                if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
                    self.enable_colors = arguments[1].to_boolean();
                }
            }
        }
        Ok(())
    }

    /// `depth`: a non-negative integer (clamped to `u16::MAX`) or `Infinity`; non-numbers are
    /// ignored. Decided on the number's value, so an integer JSC boxed as a double (a
    /// `Float64Array` element, `-0`) is accepted like its int32 twin.
    fn set_depth(&mut self, global_this: &JSGlobalObject, depth: JSValue) -> JsResult<()> {
        if !depth.is_number() {
            return Ok(());
        }
        let depth = depth.as_number();
        if depth.is_infinite() {
            self.max_depth = u16::MAX;
        } else if depth.trunc() != depth {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "expected depth to be an integer, got {depth}"
            )));
        } else if depth < 0.0 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "expected depth to be greater than or equal to 0, got {depth}"
            )));
        } else {
            self.max_depth = depth.min(f64::from(u16::MAX)) as u16;
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
    vals: &[JSValue],
    writer: &mut dyn bun_io::Write,
    options: FormatOptions,
) -> JsResult<()> {
    let len = vals.len();
    if len == 0 {
        return Ok(());
    }

    if len == 1 {
        // initialized later in this function.
        // `Formatter` has a `Drop` impl, so struct-update from a
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
            // Reborrow through the guard so SB sees body writes as children
            // of the guard's borrow (see `FlushOnDrop` doc).
            let mut _flush = FlushOnDrop {
                writer,
                enabled: options.flush,
            };
            let writer: &mut dyn bun_io::Write = &mut *_flush.writer;
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

    // Reborrow through the guard so SB sees body writes as children of the
    // guard's borrow (see `FlushOnDrop` doc).
    let mut _flush = FlushOnDrop {
        writer,
        enabled: options.flush,
    };
    let writer: &mut dyn bun_io::Write = &mut *_flush.writer;

    let mut this_value: JSValue = vals[0];
    // see E0509 note above.
    let mut fmt = Formatter::new(global);
    fmt.remaining_values = bun_ptr::RawSlice::new(&vals[1..]);
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

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct CustomFormattedObject {
    function: JSValue,
    this: JSValue,
}

// ───────────────────────────────────────────────────────────────────────────
// Formatter
// ───────────────────────────────────────────────────────────────────────────

pub use formatter::{Formatter, Tag, TagOptions, TagPayload, TagResult, visited};

pub mod formatter {
    use super::*;

    /// `&mut Formatter` for a scope that changed some formatter state; `undo`
    /// puts it back when the scope ends, however it ends.
    pub(super) struct Scoped<'f, 'a, U: FnMut(&mut Formatter<'a>)> {
        fmt: &'f mut Formatter<'a>,
        undo: U,
    }
    impl<'a, U: FnMut(&mut Formatter<'a>)> core::ops::Deref for Scoped<'_, 'a, U> {
        type Target = Formatter<'a>;
        #[inline]
        fn deref(&self) -> &Formatter<'a> {
            self.fmt
        }
    }
    impl<'a, U: FnMut(&mut Formatter<'a>)> core::ops::DerefMut for Scoped<'_, 'a, U> {
        #[inline]
        fn deref_mut(&mut self) -> &mut Formatter<'a> {
            self.fmt
        }
    }
    impl<'a, U: FnMut(&mut Formatter<'a>)> Drop for Scoped<'_, 'a, U> {
        #[inline]
        fn drop(&mut self) {
            (self.undo)(self.fmt);
        }
    }

    pub struct Formatter<'a> {
        pub global_this: &'a JSGlobalObject,

        /// Callers seat this to a stack slice and reset it to `EMPTY` before
        /// the backing storage goes away. A `&'a`
        /// slice cannot express that without forcing `'a` to outlive locals;
        /// `RawSlice` carries the outlives-holder invariant instead.
        pub(crate) remaining_values: bun_ptr::RawSlice<JSValue>,
        pub map: visited::Map,
        /// Pooled backing for `map`. `None` until the first cell that can have
        /// circular refs is formatted; `Drop` moves `map` back into it and the
        /// guard returns it to `visited::Pool`.
        pub(crate) map_node: Option<visited::PoolGuard>,
        pub(crate) hide_native: bool,
        pub(crate) indent: u32,
        pub depth: u16,
        pub(crate) max_depth: u16,
        pub quote_strings: bool,
        pub quote_keys: bool,
        pub(crate) failed: bool,
        pub(crate) estimated_line_length: usize,
        pub(crate) always_newline_scope: bool,
        pub single_line: bool,
        pub ordered_properties: bool,
        pub(crate) custom_formatted_object: CustomFormattedObject,
        pub(crate) disable_inspect_custom: bool,
        pub(crate) stack_check: StackCheck,
        pub(crate) can_throw_stack_overflow: bool,
        pub(crate) error_display_level: ErrorDisplayLevel,
        /// If `ArrayBuffer`-like objects contain ASCII text, the buffer is
        /// printed as a string. Set true in the error printer so that
        /// `ShellError` prints a more readable message.
        pub(crate) format_buffer_as_text: bool,
    }

    impl<'a> Formatter<'a> {
        /// Field-default constructor.
        pub fn new(global_this: &'a JSGlobalObject) -> Self {
            Self {
                global_this,
                remaining_values: bun_ptr::RawSlice::EMPTY,
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
                // `StackCheck::default()` has `cached_stack_end = 0` ⇒ the
                // check always passes; callers that want a real bound
                // overwrite with `StackCheck::init()` explicitly.
                stack_check: StackCheck::default(),
                can_throw_stack_overflow: false,
                error_display_level: ErrorDisplayLevel::Full,
                format_buffer_as_text: false,
            }
        }

        /// `Formatter` has a `Drop` impl and owns `map`/`map_node`,
        /// so a bit-copy via `ptr::read` would double-free. Only scalar
        /// config needs to ship — `map`/`map_node` are always empty
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
        /// Callers always seat `remaining_values` to a slice that outlives the
        /// dereference site and reset it to `EMPTY` before the backing storage
        /// is released (RawSlice invariant).
        #[inline]
        pub(crate) fn remaining(&self) -> &[JSValue] {
            self.remaining_values.slice()
        }

        /// Drop the first queued `%`-format argument.
        #[inline]
        pub(crate) fn advance_remaining(&mut self) {
            let s = self.remaining_values;
            self.remaining_values = bun_ptr::RawSlice::new(&s.slice()[1..]);
        }

        #[inline]
        pub(super) fn scoped<U: FnMut(&mut Formatter<'a>)>(
            &mut self,
            undo: U,
        ) -> Scoped<'_, 'a, U> {
            Scoped { fmt: self, undo }
        }

        /// `indent`/`depth` go back down by one when the scope ends.
        #[inline]
        pub(super) fn indented(&mut self) -> Scoped<'_, 'a, impl FnMut(&mut Formatter<'a>)> {
            self.scoped(|f| {
                f.indent = f.indent.saturating_sub(1);
                f.depth = f.depth.saturating_sub(1);
            })
        }

        /// `quote_strings = true` until the scope ends.
        #[inline]
        pub(super) fn quoting_strings(&mut self) -> Scoped<'_, 'a, impl FnMut(&mut Formatter<'a>)> {
            let prev = self.quote_strings;
            self.quote_strings = true;
            self.scoped(move |f| f.quote_strings = prev)
        }

        /// `quote_keys = true` until the scope ends.
        #[inline]
        pub(super) fn quoting_keys(&mut self) -> Scoped<'_, 'a, impl FnMut(&mut Formatter<'a>)> {
            let prev = self.quote_keys;
            self.quote_keys = true;
            self.scoped(move |f| f.quote_keys = prev)
        }
    }

    impl Drop for Formatter<'_> {
        fn drop(&mut self) {
            if let Some(mut node) = self.map_node.take() {
                // Move the working map back into the pooled node, shrink if it
                // ballooned; dropping the guard returns the node to the
                // thread-local pool.
                *node = core::mem::take(&mut self.map);
                if node.capacity() > 512 {
                    node.deinit();
                } else {
                    node.clear();
                }
            }
        }
    }

    impl Formatter<'_> {
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

        pub fn add_for_new_line(&mut self, len: usize) {
            self.estimated_line_length = self.estimated_line_length.saturating_add(len);
        }
    }

    /// `Display` adapter that formats a single `JSValue` through a borrowed
    /// `Formatter`.
    ///
    /// `Display::fmt` only
    /// gives us `&self`, so the mutable handle is parked behind a `Cell` and
    /// moved out for the duration of the call — this preserves unique-borrow
    /// provenance without the `&shared → *const → *mut` cast that would be UB
    /// under Stacked Borrows.
    pub struct ZigFormatter<'a, 'b> {
        pub(crate) formatter: Cell<Option<&'a mut Formatter<'b>>>,
        pub value: JSValue,
    }

    impl<'a, 'b> ZigFormatter<'a, 'b> {
        pub fn new(formatter: &'a mut Formatter<'b>, value: JSValue) -> Self {
            Self {
                formatter: Cell::new(Some(formatter)),
                value,
            }
        }
    }

    impl core::fmt::Display for ZigFormatter<'_, '_> {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            let formatter: &mut Formatter<'_> = self
                .formatter
                .take()
                .expect("ZigFormatter::fmt re-entered or used after consumption");

            let mut sink = bun_io::FmtAdapter::new(f);
            let result = formatter
                .format_value::<false>(self.value, &mut sink)
                .map_err(|_| core::fmt::Error);

            self.formatter.set(Some(formatter));
            result
        }
    }

    /// For detecting circular references.
    pub mod visited {
        use super::*;

        /// Newtype over `HashMap<JSValue, ()>` so we can implement
        /// `ObjectPoolType` (orphan rules forbid impl on the foreign
        /// `bun_collections::HashMap`). `Deref`/`DerefMut` keep all
        /// `self.map.*` call sites unchanged.
        #[derive(Default)]
        #[repr(transparent)]
        pub struct Map(bun_collections::HashMap<JSValue, ()>);

        impl core::ops::Deref for Map {
            type Target = bun_collections::HashMap<JSValue, ()>;
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

        impl bun_collections::pool::ObjectPoolType for Map {
            // Fresh nodes start with an empty map so clearing retained
            // capacity on first use is well-defined.
            const INIT: Option<fn() -> Result<Self, bun_core::Error>> = Some(|| Ok(Map::default()));
        }

        // Thread-local free list, capped at 16 nodes.
        bun_collections::object_pool!(pub Pool: Map, threadsafe, 16);
        /// A node checked out of [`Pool`]; returned to it on drop.
        pub type PoolGuard = bun_collections::pool::PoolGuard<'static, Map>;
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

        pub(crate) fn can_have_circular_references(self) -> bool {
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

    /// Only `CustomFormattedObject` carries a payload.
    #[derive(Copy, Clone, PartialEq, Eq)]
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
        pub(crate) fn is_primitive(self) -> bool {
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
            Self {
                tag: TagPayload::Undefined,
                cell: jsc::JSType::Cell,
            }
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

        pub(crate) fn get_advanced(
            value: JSValue,
            global_this: &JSGlobalObject,
            opts: TagOptions,
        ) -> JsResult<TagResult> {
            if value.is_empty() || value == JSValue::UNDEFINED {
                return Ok(TagResult {
                    tag: TagPayload::Undefined,
                    ..Default::default()
                });
            }
            if value == JSValue::NULL {
                return Ok(TagResult {
                    tag: TagPayload::Null,
                    ..Default::default()
                });
            }

            if value.is_int32() {
                return Ok(TagResult {
                    tag: TagPayload::Integer,
                    ..Default::default()
                });
            } else if value.is_number() {
                return Ok(TagResult {
                    tag: TagPayload::Double,
                    ..Default::default()
                });
            } else if value.is_boolean() {
                return Ok(TagResult {
                    tag: TagPayload::Boolean,
                    ..Default::default()
                });
            }

            if !value.is_cell() {
                return Ok(TagResult {
                    tag: TagPayload::NativeCode,
                    ..Default::default()
                });
            }

            let js_type = value.js_type();

            if js_type.is_hidden() {
                return Ok(TagResult {
                    tag: TagPayload::NativeCode,
                    cell: js_type,
                });
            }

            if js_type == jsc::JSType::Cell {
                return Ok(TagResult {
                    tag: TagPayload::NativeCode,
                    cell: js_type,
                });
            }

            if js_type.can_get()
                && js_type != jsc::JSType::ProxyObject
                && !opts.contains(TagOptions::DISABLE_INSPECT_CUSTOM)
            {
                // Attempt to get custom formatter
                match value.fast_get(global_this, jsc::BuiltinName::InspectCustom) {
                    Err(_) => {
                        return Ok(TagResult {
                            tag: TagPayload::RevokedProxy,
                            ..Default::default()
                        });
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
                return Ok(TagResult {
                    tag: TagPayload::Private,
                    cell: js_type,
                });
            }

            // If we check an Object has a method table and it does not it will crash
            if js_type != jsc::JSType::Object
                && js_type != jsc::JSType::ProxyObject
                && value.is_callable()
            {
                if value.is_class(global_this) {
                    return Ok(TagResult {
                        tag: TagPayload::Class,
                        cell: js_type,
                    });
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
                if !opts.contains(TagOptions::HIDE_GLOBAL) {
                    return Tag::get(value.get_proxy_target(), global_this);
                }
                return Ok(TagResult {
                    tag: TagPayload::GlobalObject,
                    cell: js_type,
                });
            }

            // Is this a react element?
            if js_type.is_object() && js_type != jsc::JSType::ProxyObject {
                if let Some(typeof_symbol) = value.get_own_truthy(global_this, "$$typeof")? {
                    // React 18 and below
                    if typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, b"react.element"),
                        global_this,
                    )? || typeof_symbol.is_same_value(
                        // For React 19 - https://github.com/oven-sh/bun/issues/17223
                        JSValue::symbol_for(global_this, b"react.transitional.element"),
                        global_this,
                    )? || typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, b"react.fragment"),
                        global_this,
                    )? {
                        return Ok(TagResult {
                            tag: TagPayload::JSX,
                            cell: js_type,
                        });
                    }
                }
            }

            use jsc::JSType as T;
            let tag = match js_type {
                T::ErrorInstance => TagPayload::Error,
                T::NumberObject => TagPayload::Double,
                T::DerivedArray
                | T::Array
                | T::DirectArguments
                | T::ScopedArguments
                | T::ClonedArguments => TagPayload::Array,
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
                    let handler = value.get_proxy_internal_field(jsc::ProxyField::Handler);
                    if handler.is_empty() || handler.is_undefined_or_null() {
                        return Ok(TagResult {
                            tag: TagPayload::RevokedProxy,
                            cell: js_type,
                        });
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

    /// <https://console.spec.whatwg.org/#formatter>
    #[derive(Copy, Clone, Eq, PartialEq)]
    enum PercentTag {
        S,      // s
        I,      // i or d
        F,      // f
        O,      // o (lowercase)
        UpperO, // O
        C,      // c
        J,      // j
    }

    impl<'a> Formatter<'a> {
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

                        // borrowck — `writer` holds `&mut self.estimated_line_length`,
                        // so route `remaining_values` reads/writes through the `RawSlice`
                        // field directly instead of the `&self` helper methods.
                        if self.remaining_values.is_empty() {
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
                                // Start the next iteration at `slice[1]`,
                                // not `slice[0]`. (This is itself an
                                // off-by-one vs the WHATWG spec; tracked
                                // separately.)
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
                        let next_value = {
                            let s = self.remaining_values;
                            self.remaining_values = bun_ptr::RawSlice::new(&s.slice()[1..]);
                            s.slice()[0]
                        };

                        // https://console.spec.whatwg.org/#formatter
                        const MAX_BEFORE_E_NOTATION: f64 = 1.0e21;
                        const MIN_BEFORE_E_NOTATION: f64 = 0.000001;
                        match token {
                            PercentTag::S => {
                                self.print_as::<ENABLE_ANSI_COLORS>(
                                    Tag::String,
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

                                writer.add_for_new_line(if i != 0 {
                                    bun_core::fmt::digit_count(int)
                                } else {
                                    1
                                });
                                writer.print(format_args!("{int}"));
                            }

                            PercentTag::F => {
                                // 1. If Type(current) is Symbol, let converted be NaN
                                // 2. Otherwise, let converted be the result of
                                //    Call(%parseFloat%, undefined, [current]).
                                let converted: f64 = 'brk: {
                                    if next_value.is_int32() {
                                        let int = next_value.as_int32();
                                        writer.add_for_new_line(if i != 0 {
                                            bun_core::fmt::digit_count(int)
                                        } else {
                                            1
                                        });
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
                                let str = next_value.json_stringify_fast(global)?;
                                writer.add_for_new_line(str.length());
                                writer.print(format_args!("{str}"));
                            }
                        }
                        if self.remaining_values.is_empty() {
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

    /// Failure-tracking writer wrapper over `&mut dyn bun_io::Write`.
    // PERF: dynamic dispatch rather than monomorphization — profile if hot.
    pub struct WrappedWriter<'w> {
        pub ctx: &'w mut dyn bun_io::Write,
        pub(crate) failed: bool,
        pub(crate) estimated_line_length: &'w mut usize,
    }

    impl<'w> WrappedWriter<'w> {
        /// Mirror of `Formatter::add_for_new_line` routed through the borrowed
        /// `estimated_line_length` so callers don't need a second `&mut self`
        /// on the parent `Formatter` while a `WrappedWriter` is live.
        pub(crate) fn add_for_new_line(&mut self, len: usize) {
            *self.estimated_line_length = self.estimated_line_length.saturating_add(len);
        }

        /// Mirror of `Formatter::reset_line` routed through the borrowed
        /// `estimated_line_length`. Takes the current `Formatter::indent` by
        /// value so the caller can pass `self.indent` (a disjoint field
        /// borrow) while this `WrappedWriter` is live.
        pub(crate) fn reset_line(&mut self, indent: u32) {
            *self.estimated_line_length = (indent as usize) * 2;
        }

        /// Mirror of `Formatter::good_time_for_a_new_line` routed through the
        /// borrowed `estimated_line_length`.
        pub(crate) fn good_time_for_a_new_line(&mut self, indent: u32) -> bool {
            if *self.estimated_line_length > 80 {
                self.reset_line(indent);
                return true;
            }
            false
        }

        /// Mirror of `Formatter::print_comma` routed through the wrapped
        /// `ctx` writer + borrowed `estimated_line_length`.
        pub(crate) fn print_comma<const ENABLE_ANSI_COLORS: bool>(&mut self) {
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
        pub(crate) fn write_indent(&mut self, indent: u32) {
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

        pub(crate) fn print(&mut self, args: core::fmt::Arguments<'_>) {
            if self.ctx.write_fmt(args).is_err() {
                self.failed = true;
            }
        }

        pub(crate) fn space(&mut self) {
            *self.estimated_line_length += 1;
            if self.ctx.write_all(b" ").is_err() {
                self.failed = true;
            }
        }

        // `fmt_len` (the length ignoring formatted values) is a runtime
        // argument computed by the `pretty!` macro.
        pub(crate) fn pretty<const ENABLE_ANSI_COLOR: bool>(
            &mut self,
            fmt_len: usize,
            args: core::fmt::Arguments<'_>,
        ) {
            *self.estimated_line_length += fmt_len;
            if self.ctx.write_fmt(args).is_err() {
                self.failed = true;
            }
        }

        #[inline]
        pub(crate) fn write_all(&mut self, buf: &[u8]) {
            if self.ctx.write_all(buf).is_err() {
                self.failed = true;
            }
        }

        #[inline]
        pub(crate) fn write_string(&mut self, str: &bun_core::String) {
            self.print(format_args!("{str}"));
        }

        #[inline]
        pub(crate) fn write_16_bit(&mut self, input: &[u16]) {
            // `format_utf16_type` requires `impl fmt::Write + Sized`; route through
            // the `Display` adapter so we go via `bun_io::Write::write_fmt` instead.
            self.print(format_args!(
                "{}",
                bun_core::fmt::FormatUTF16 {
                    buf: input,
                    path_fmt_opts: None
                }
            ));
        }
    }

    const INDENTATION_BUF: [u8; 64] = [b' '; 64];

    /// Free-function indent writer for callsites where a `WrappedWriter`
    /// already holds `&mut self.estimated_line_length`, which would otherwise
    /// conflict with the `&self` borrow `Formatter::write_indent` takes.
    /// `self.indent` is a disjoint field read, so passing it by value here
    /// keeps the borrow checker happy.
    fn write_indent_n(indent: u32, writer: &mut dyn bun_io::Write) -> bun_io::Result<()> {
        let mut total_remain: u32 = indent;
        while total_remain > 0 {
            let written: u8 = total_remain.min(32) as u8;
            writer.write_all(&INDENTATION_BUF[0..(written as usize) * 2])?;
            total_remain = total_remain.saturating_sub(u32::from(written));
        }
        Ok(())
    }

    impl Formatter<'_> {
        pub(crate) fn write_indent(&self, writer: &mut dyn bun_io::Write) -> bun_io::Result<()> {
            write_indent_n(self.indent, writer)
        }

        pub(crate) fn print_comma<const ENABLE_ANSI_COLORS: bool>(
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

    pub(crate) struct MapIteratorCtx<
        'a,
        'b,
        const C: bool,
        const IS_ITERATOR: bool,
        const SINGLE_LINE: bool,
    > {
        pub(crate) formatter: &'a mut Formatter<'b>,
        pub(crate) writer: &'a mut dyn bun_io::Write,
        pub(crate) count: usize,
    }

    impl<const C: bool, const IS_ITERATOR: bool, const SINGLE_LINE: bool> jsc::ForEachContext
        for MapIteratorCtx<'_, '_, C, IS_ITERATOR, SINGLE_LINE>
    {
        fn on_value(&mut self, global_object: &JSGlobalObject, next_value: JSValue) {
            let this = self;
            if this.formatter.failed {
                return;
            }
            if SINGLE_LINE && this.count > 0 {
                this.formatter
                    .print_comma::<C>(this.writer)
                    .expect("unreachable");
                this.writer.write_all(b" ").expect("unreachable");
            }
            if !IS_ITERATOR {
                let Ok(key) = next_value.get_index(global_object, 0) else {
                    return;
                };
                let Ok(value) = next_value.get_index(global_object, 1) else {
                    return;
                };

                if !SINGLE_LINE {
                    this.formatter
                        .write_indent(this.writer)
                        .expect("unreachable");
                }
                let mut opts = TagOptions::HIDE_GLOBAL;
                if this.formatter.disable_inspect_custom {
                    opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
                }
                let Ok(key_tag) = Tag::get_advanced(key, global_object, opts) else {
                    return;
                };

                let _ = this.formatter.format::<C>(
                    key_tag,
                    this.writer,
                    key,
                    this.formatter.global_this,
                );
                this.writer.write_all(b": ").expect("unreachable");
                let Ok(value_tag) = Tag::get_advanced(value, global_object, opts) else {
                    return;
                };
                let _ = this.formatter.format::<C>(
                    value_tag,
                    this.writer,
                    value,
                    this.formatter.global_this,
                );
            } else {
                if !SINGLE_LINE {
                    this.writer.write_all(b"\n").expect("unreachable");
                    this.formatter
                        .write_indent(this.writer)
                        .expect("unreachable");
                }
                let mut opts = TagOptions::HIDE_GLOBAL;
                if this.formatter.disable_inspect_custom {
                    opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
                }
                let Ok(tag) = Tag::get_advanced(next_value, global_object, opts) else {
                    return;
                };
                let _ = this.formatter.format::<C>(
                    tag,
                    this.writer,
                    next_value,
                    this.formatter.global_this,
                );
            }
            this.count += 1;
            if !SINGLE_LINE {
                this.formatter
                    .print_comma::<C>(this.writer)
                    .expect("unreachable");
                if !IS_ITERATOR {
                    this.writer.write_all(b"\n").expect("unreachable");
                }
            }
        }
    }

    pub(crate) struct SetIteratorCtx<'a, 'b, const C: bool, const SINGLE_LINE: bool> {
        pub(crate) formatter: &'a mut Formatter<'b>,
        pub(crate) writer: &'a mut dyn bun_io::Write,
        pub(crate) is_first: bool,
    }

    impl<const C: bool, const SINGLE_LINE: bool> jsc::ForEachContext
        for SetIteratorCtx<'_, '_, C, SINGLE_LINE>
    {
        fn on_value(&mut self, global_object: &JSGlobalObject, next_value: JSValue) {
            let this = self;
            if this.formatter.failed {
                return;
            }
            if SINGLE_LINE {
                if !this.is_first {
                    this.formatter
                        .print_comma::<C>(this.writer)
                        .expect("unreachable");
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
            let Ok(key_tag) = Tag::get_advanced(next_value, global_object, opts) else {
                return;
            };
            let _ = this.formatter.format::<C>(
                key_tag,
                this.writer,
                next_value,
                this.formatter.global_this,
            );

            if !SINGLE_LINE {
                this.formatter
                    .print_comma::<C>(this.writer)
                    .expect("unreachable");
                this.writer.write_all(b"\n").expect("unreachable");
            }
        }
    }

    pub(crate) struct PropertyIteratorCtx<'a, 'b, const C: bool> {
        pub(crate) formatter: &'a mut Formatter<'b>,
        pub(crate) writer: &'a mut dyn bun_io::Write,
        pub(crate) i: usize,
        pub(crate) single_line: bool,
        pub(crate) always_newline: bool,
        pub(crate) parent: JSValue,
    }

    impl<'a, 'b, const C: bool> PropertyIteratorCtx<'a, 'b, C> {
        pub(crate) fn handle_first_property(
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

        /// Prints `key:` (with quoting/symbol decoration) and the optional
        /// string-value colour prefix. Hoisted out of `for_each` so its
        /// `format_args!` temporaries are popped before the recursive
        /// `format()` call — keeps the per-level frame small enough for the
        /// 512-deep `Bun.inspect` test under debug/ASAN.
        #[inline(never)]
        fn write_property_key(
            writer: &mut WrappedWriter<'_>,
            key: &EncodedSlice,
            is_symbol: bool,
            is_private_symbol: bool,
            quote_keys: bool,
            value_is_string_like: bool,
        ) {
            if !is_symbol {
                // TODO: make this one pass?
                if (!key.is_16bit()
                    && (!quote_keys && JSLexer::is_latin1_identifier_u8(key.slice())))
                    || (key.is_16bit()
                        && (!quote_keys && JSLexer::is_latin1_identifier_u16(key.utf16_slice())))
                {
                    writer.add_for_new_line(key.len + 1);
                    writer.print(format_args!(
                        concat!("{}", "{}", "{}"),
                        pfmt!("<r>", C),
                        key,
                        pfmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16bit() {
                    let mut utf16_slice = key.utf16_slice();

                    writer.add_for_new_line(utf16_slice.len() + 2);

                    if C {
                        writer.write_all(pfmt!("<r><green>", true).as_bytes());
                    }

                    writer.write_all(b"\"");

                    const QUOTE_U16: &[u16] = &[b'"' as u16];
                    while let Some(j) = strings::index_of_any16(utf16_slice, QUOTE_U16) {
                        writer.write_16_bit(&utf16_slice[0..j]);
                        writer.write_all(b"\"");
                        utf16_slice = &utf16_slice[j + 1..];
                    }

                    writer.write_16_bit(utf16_slice);

                    writer.print(format_args!("{}", pfmt!("\"<r><d>:<r> ", C)));
                } else {
                    writer.add_for_new_line(key.len + 2);

                    writer.print(format_args!(
                        "{}{}{}",
                        pfmt!("<r><green>", C),
                        bun_core::fmt::format_json_string_latin1(key.slice()),
                        pfmt!("<r><d>:<r> ", C),
                    ));
                }
            } else if cfg!(debug_assertions) && is_private_symbol {
                writer.add_for_new_line(1 + "$:".len() + key.len);
                writer.print(format_args!(
                    "{}{}{}{}",
                    pfmt!("<r><magenta>", C),
                    if key.len > 0 && key.char_at(0) == u16::from(b'#') {
                        ""
                    } else {
                        "$"
                    },
                    key,
                    pfmt!("<r><d>:<r> ", C),
                ));
            } else {
                writer.add_for_new_line(1 + "[Symbol()]:".len() + key.len);
                writer.print(format_args!(
                    "{}Symbol({}){}",
                    pfmt!("<r><d>[<r><blue>", C),
                    key,
                    pfmt!("<r><d>]:<r> ", C),
                ));
            }

            if value_is_string_like {
                if C {
                    writer.write_all(pfmt!("<r><green>", true).as_bytes());
                }
            }
        }

        /// Everything `for_each` does *before* recursing into `format()` for
        /// the property value. Outlined so the recursive frame in `for_each`
        /// itself carries only `ctx` + the returned `TagResult`, not the
        /// dozen-plus locals (and their ASAN redzones) needed to write the
        /// key/comma/indent. Returns `None` to skip the property.
        #[inline(never)]
        fn for_each_prelude(
            ctx: &mut Self,
            global_this: &JSGlobalObject,
            key: &EncodedSlice,
            value: JSValue,
            is_symbol: bool,
            is_private_symbol: bool,
        ) -> Option<TagResult> {
            if key.eq_ascii(b"constructor") {
                return None;
            }
            if ctx.formatter.failed {
                return None;
            }

            let disable_inspect_custom = ctx.formatter.disable_inspect_custom;
            let single_line = ctx.formatter.single_line;
            let always_newline_scope = ctx.formatter.always_newline_scope;
            let quote_keys = ctx.formatter.quote_keys;
            let indent = ctx.formatter.indent;

            let mut opts = TagOptions::HIDE_GLOBAL;
            if disable_inspect_custom {
                opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
            }
            let tag = Tag::get_advanced(value, global_this, opts).ok()?;
            if tag.cell.is_hidden() {
                return None;
            }

            if ctx.i == 0 {
                if ctx.handle_first_property(global_this, ctx.parent).is_err() {
                    return None;
                }
            }

            let mut writer = WrappedWriter {
                ctx: &mut *ctx.writer,
                failed: false,
                estimated_line_length: &mut ctx.formatter.estimated_line_length,
            };
            if ctx.i > 0 {
                writer.print_comma::<C>();
            }

            let i_before = ctx.i;
            ctx.i += 1;

            if i_before > 0 {
                if !single_line
                    && (ctx.always_newline
                        || always_newline_scope
                        || writer.good_time_for_a_new_line(indent))
                {
                    writer.write_all(b"\n");
                    writer.write_indent(indent);
                    writer.reset_line(indent);
                } else {
                    writer.space();
                }
            }

            Self::write_property_key(
                &mut writer,
                key,
                is_symbol,
                is_private_symbol,
                quote_keys,
                tag.cell.is_string_like(),
            );

            let writer_failed = writer.failed;
            if writer_failed {
                ctx.formatter.failed = true;
            }
            Some(tag)
        }
    }

    impl<const C: bool> jsc::ForEachPropertyContext for PropertyIteratorCtx<'_, '_, C> {
        fn on_property(
            &mut self,
            global_this: &JSGlobalObject,
            key: &EncodedSlice,
            value: JSValue,
            is_symbol: bool,
            is_private_symbol: bool,
        ) {
            let ctx = self;
            let Some(tag) =
                Self::for_each_prelude(ctx, global_this, key, value, is_symbol, is_private_symbol)
            else {
                return;
            };

            // `format` requires a `&'b JSGlobalObject`; the anonymous-lifetime
            // `global_this` parameter cannot satisfy that, so reuse the
            // formatter's own handle (same pointer in practice).
            let format_global = ctx.formatter.global_this;
            let _ = ctx
                .formatter
                .format::<C>(tag, &mut *ctx.writer, value, format_global);

            if C && tag.cell.is_string_like() {
                if ctx.writer.write_all(pfmt!("<r>", true).as_bytes()).is_err() {
                    ctx.formatter.failed = true;
                }
            }
        }
    }

    fn get_object_name(
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<bun_core::String>> {
        let name_str = value.get_class_name(global_this)?;
        if !name_str.eq_ascii(b"Object") {
            return Ok(Some(name_str));
        } else if value.get_prototype(global_this)?.eql_value(JSValue::NULL) {
            return Ok(Some(bun_core::String::static_("[Object: null prototype]")));
        }
        Ok(None)
    }

    // `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; remaining
    // params are by-value `JSValue`/scalars → `safe fn`.
    unsafe extern "C" {
        /// C++ helper (`bindings.cpp`) — invokes a user-supplied
        /// `[util.inspect.custom]` function with the synthesized `(depth, opts,
        /// inspect)` argument shape. Only called from `print_as`.
        safe fn JSC__JSValue__callCustomInspectFunction(
            global: &JSGlobalObject,
            function: JSValue,
            this: JSValue,
            depth: u32,
            max_depth: u32,
            colors: bool,
        ) -> JSValue;
    }

    // ───────────────────────────────────────────────────────────────────────
    // print_as — the big tag-dispatched printer
    // ───────────────────────────────────────────────────────────────────────

    impl<'a> Formatter<'a> {
        /// Circular-reference / stack-overflow / visited-map prelude for
        /// `print_as`. Outlined so its locals (the pool node, the
        /// `get_or_put` result, the `[Circular]` write path) live in a leaf
        /// frame that is popped before the recursive descent into
        /// `print_object`/`print_array` — under ASAN debug those locals each
        /// carry a 32-byte redzone, and the 512-deep `Bun.inspect` test
        /// cannot afford them in the per-level `print_as` frame.
        ///
        /// Returns `Ok(true)` to continue into the tag dispatch.
        #[inline(never)]
        fn print_as_prelude<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            can_circ: bool,
            remove_before_recurse: &mut bool,
        ) -> JsResult<bool> {
            if self.failed {
                return Ok(false);
            }
            if self.global_this.has_exception() {
                return Err(jsc::JsError::Thrown);
            }
            if !can_circ {
                return Ok(true);
            }

            if !self.stack_check.is_safe_to_recurse() {
                self.failed = true;
                if self.can_throw_stack_overflow {
                    return Err(self.global_this.throw_stack_overflow());
                }
                return Ok(false);
            }

            if self.map_node.is_none() {
                let mut node = visited::Pool::get();
                node.clear();
                self.map = core::mem::take(&mut *node);
                self.map_node = Some(node);
            }

            let entry = self.map.get_or_put(value).expect("unreachable");
            if entry.found_existing {
                if writer_
                    .write_all(pfmt!("<r><cyan>[Circular]<r>", C).as_bytes())
                    .is_err()
                {
                    self.failed = true;
                }
                return Ok(false);
            }
            *remove_before_recurse = true;
            Ok(true)
        }

        #[inline(never)]
        pub(crate) fn print_as<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            format: Tag,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            // If we call `return self.print_as(...)` then we can get a spurious
            // `[Circular]` due to the value already being present in the map.
            let mut remove_before_recurse = false;

            if !self.print_as_prelude::<ENABLE_ANSI_COLORS>(
                writer_,
                value,
                format.can_have_circular_references(),
                &mut remove_before_recurse,
            )? {
                return Ok(());
            }

            // Each arm is hoisted to its own `#[inline(never)]` helper so the
            // `print_as` frame stays small enough to recurse 512 levels under
            // debug/ASAN before the stack-safety check fires.
            let result = match format {
                Tag::StringPossiblyFormatted => {
                    self.print_string_possibly_formatted::<ENABLE_ANSI_COLORS>(writer_, value)
                }
                Tag::String => self.print_string::<ENABLE_ANSI_COLORS>(writer_, value, js_type),
                Tag::Integer => self.print_integer::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::BigInt => self.print_bigint::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Double => self.print_double::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Undefined => self.print_undefined::<ENABLE_ANSI_COLORS>(writer_),
                Tag::Null => self.print_null::<ENABLE_ANSI_COLORS>(writer_),
                Tag::CustomFormattedObject => {
                    self.print_custom_formatted_object::<ENABLE_ANSI_COLORS>(writer_)
                }
                Tag::Symbol => self.print_symbol::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Error => self.print_error::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Class => self.print_class::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Function => self.print_function::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::GetterSetter => {
                    self.print_getter_setter::<ENABLE_ANSI_COLORS, false>(writer_, value)
                }
                Tag::CustomGetterSetter => {
                    self.print_getter_setter::<ENABLE_ANSI_COLORS, true>(writer_, value)
                }
                Tag::Array => self.print_array::<ENABLE_ANSI_COLORS>(writer_, value, js_type),
                Tag::Private => self.print_private::<ENABLE_ANSI_COLORS>(
                    writer_,
                    value,
                    js_type,
                    &mut remove_before_recurse,
                ),
                Tag::NativeCode => self.print_native_code(writer_, value),
                Tag::Promise => self.print_promise::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Boolean => self.print_boolean::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::GlobalObject => self.print_global_object::<ENABLE_ANSI_COLORS>(writer_),
                Tag::Map => self.print_map_like::<ENABLE_ANSI_COLORS, false>(writer_, value),
                Tag::MapIterator => self.print_map_iterator_like::<ENABLE_ANSI_COLORS>(
                    writer_,
                    value,
                    "MapIterator",
                ),
                Tag::SetIterator => self.print_map_iterator_like::<ENABLE_ANSI_COLORS>(
                    writer_,
                    value,
                    "SetIterator",
                ),
                Tag::Set => self.print_set::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::ToJSON => self.print_to_json::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::JSON => self.print_json::<ENABLE_ANSI_COLORS>(writer_, value, js_type),
                Tag::Event => self.print_event::<ENABLE_ANSI_COLORS>(
                    writer_,
                    value,
                    &mut remove_before_recurse,
                ),
                Tag::JSX => self.print_jsx::<ENABLE_ANSI_COLORS>(writer_, value),
                Tag::Object => self.print_object::<ENABLE_ANSI_COLORS>(writer_, value, js_type),
                Tag::TypedArray => {
                    self.print_typed_array::<ENABLE_ANSI_COLORS>(writer_, value, js_type)
                }
                Tag::RevokedProxy => self.print_revoked_proxy::<ENABLE_ANSI_COLORS>(writer_),
                Tag::Proxy => self.print_proxy::<ENABLE_ANSI_COLORS>(writer_, value),
            };
            // The arms may flip `remove_before_recurse`; act on its final value.
            if remove_before_recurse {
                let _ = self.map.remove(&value);
            }
            result
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Per-tag helpers split out of print_as
    //
    // Rust does not DCE dead `match` arms on a const
    // generic in debug builds, so keeping these inline in `print_as` would
    // make every
    // recursive `print_as` frame carry the union of all arms' locals. Each
    // body is therefore its own `#[inline(never)]` function.
    // ───────────────────────────────────────────────────────────────────────

    impl<'a> Formatter<'a> {
        fn tag_opts(&self) -> TagOptions {
            let mut opts = TagOptions::HIDE_GLOBAL;
            if self.disable_inspect_custom {
                opts |= TagOptions::DISABLE_INSPECT_CUSTOM;
            }
            opts
        }

        #[inline(never)]
        fn print_undefined<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            writer.add_for_new_line(9);
            writer.print(format_args!(
                "{}undefined{}",
                pfmt!("<r><d>", C),
                pfmt!("<r>", C)
            ));
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_null<const C: bool>(&mut self, writer_: &mut dyn bun_io::Write) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            writer.add_for_new_line(4);
            writer.print(format_args!(
                "{}null{}",
                pfmt!("<r><yellow>", C),
                pfmt!("<r>", C)
            ));
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_native_code(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            if let Some(class_name) = value.get_class_info_name() {
                writer.add_for_new_line("[native code: ]".len() + class_name.len());
                writer.write_all(b"[native code: ");
                writer.write_all(class_name);
                writer.write_all(b"]");
            } else {
                writer.add_for_new_line("[native code]".len());
                writer.write_all(b"[native code]");
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_global_object<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            const FMT: &str = "[Global Object]";
            writer.add_for_new_line(FMT.len());
            writer.write_all(pfmt!(concat!("<cyan>", "[Global Object]", "<r>"), C).as_bytes());
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_revoked_proxy<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            writer.add_for_new_line("<Revoked Proxy>".len());
            writer.print(format_args!(
                "{}<Revoked Proxy>{}",
                pfmt!("<r><cyan>", C),
                pfmt!("<r>", C)
            ));
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_proxy<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let target = value.get_proxy_internal_field(jsc::ProxyField::Target);
            // Proxy does not allow non-objects here.
            debug_assert!(target.is_cell());
            // TODO: if (options.showProxy), print like
            // `Proxy { target: ..., handlers: ... }` — this is default off so
            // it is not used.
            self.format::<C>(
                Tag::get(target, self.global_this)?,
                writer_,
                target,
                self.global_this,
            )
        }

        #[inline(never)]
        fn print_string_possibly_formatted<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let str = value.to_utf8(self.global_this)?;
            let slice = str.slice();
            self.add_for_new_line(slice.len());
            self.write_with_formatting::<C>(writer_, slice, self.global_this)
        }

        #[inline(never)]
        fn print_string<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            // This is called from the '%s' formatter, so it can actually be any value
            use crate::StringJsc as _;
            let str = BunString::from_js(value, self.global_this)?;
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            writer.add_for_new_line(str.length());

            if self.quote_strings && js_type != jsc::JSType::RegExpObject {
                if str.is_empty() {
                    writer.write_all(b"\"\"");
                    if writer.failed {
                        self.failed = true;
                    }
                    return Ok(());
                }

                if C {
                    writer.write_all(pfmt!("<r><green>", true).as_bytes());
                }

                if str.is_utf16() {
                    if writer.failed {
                        self.failed = true;
                    }
                    self.print_as::<C>(Tag::JSON, writer_, value, jsc::JSType::StringObject)?;
                    if C {
                        let _ = writer_.write_all(pfmt!("<r>", true).as_bytes());
                    }
                    return Ok(());
                }

                JSPrinter::write_json_string(str.latin1(), writer.ctx, JSPrinter::Encoding::Latin1)
                    .expect("unreachable");

                if C {
                    writer.write_all(pfmt!("<r>", true).as_bytes());
                }
                if writer.failed {
                    self.failed = true;
                }
                return Ok(());
            }

            if js_type == jsc::JSType::StringObject {
                if C {
                    writer.print(format_args!("{}", pfmt!("<r><green>", C)));
                }
                writer.print(format_args!("[String: "));

                if str.is_utf16() {
                    if writer.failed {
                        self.failed = true;
                    }
                    self.print_as::<C>(Tag::JSON, writer_, value, jsc::JSType::StringObject)?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };
                } else {
                    JSPrinter::write_json_string(
                        str.latin1(),
                        writer.ctx,
                        JSPrinter::Encoding::Latin1,
                    )
                    .expect("unreachable");
                }

                writer.print(format_args!("]"));
                if C {
                    writer.write_all(pfmt!("<r>", true).as_bytes());
                }
                if writer.failed {
                    self.failed = true;
                }
                return Ok(());
            }

            if js_type == jsc::JSType::RegExpObject && C {
                writer.print(format_args!("{}", pfmt!("<r><red>", C)));
            }

            if str.is_utf16() {
                // streaming print
                writer.print(format_args!("{str}"));
            } else if let Some(slice) = str.as_utf8() {
                // fast path
                writer.write_all(slice);
            } else if !str.is_empty() {
                // slow path
                let buf = strings::allocate_latin1_into_utf8(str.latin1()).unwrap_or_default();
                if !buf.is_empty() {
                    writer.write_all(&buf);
                }
            }

            if js_type == jsc::JSType::RegExpObject && C {
                writer.print(format_args!("{}", pfmt!("<r>", C)));
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_integer<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let int = value.coerce_to_int64(self.global_this)?;
            writer.add_for_new_line(bun_core::fmt::digit_count(int));
            writer.print(format_args!(
                "{}{}{}",
                pfmt!("<r><yellow>", C),
                int,
                pfmt!("<r>", C)
            ));
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_bigint<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let view = value.to_js_string_view(self.global_this)?;
            let out_str = view.latin1();
            writer.add_for_new_line(out_str.len());
            writer.print(format_args!(
                "{}{}n{}",
                pfmt!("<r><yellow>", C),
                bstr::BStr::new(out_str),
                pfmt!("<r>", C)
            ));
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_double<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
            if value.is_cell() {
                let number_name = value.get_class_name(self.global_this)?;

                let number_value = value.to_js_string_view(self.global_this)?;

                if !number_name.eq_ascii(b"Number") {
                    writer.add_for_new_line(
                        number_name.length() + number_value.length() + "[Number ():]".len(),
                    );
                    writer.print(format_args!(
                        "{}[Number ({}): {}]{}",
                        pf!("<r><yellow>"),
                        number_name,
                        number_value,
                        pf!("<r>")
                    ));
                    if writer.failed {
                        self.failed = true;
                    }
                    return Ok(());
                }

                writer.add_for_new_line(number_name.length() + number_value.length() + 4);
                writer.print(format_args!(
                    "{}[{}: {}]{}",
                    pf!("<r><yellow>"),
                    number_name,
                    number_value,
                    pf!("<r>")
                ));
                if writer.failed {
                    self.failed = true;
                }
                return Ok(());
            }

            let num = value.as_number();

            if num.is_infinite() && num > 0.0 {
                writer.add_for_new_line("Infinity".len());
                writer.print(format_args!("{}Infinity{}", pf!("<r><yellow>"), pf!("<r>")));
            } else if num.is_infinite() && num < 0.0 {
                writer.add_for_new_line("-Infinity".len());
                writer.print(format_args!(
                    "{}-Infinity{}",
                    pf!("<r><yellow>"),
                    pf!("<r>")
                ));
            } else if num.is_nan() {
                writer.add_for_new_line("NaN".len());
                writer.print(format_args!("{}NaN{}", pf!("<r><yellow>"), pf!("<r>")));
            } else {
                let mut buf = [0u8; 124];
                let formatted = bun_core::fmt::FormatDouble::dtoa_with_negative_zero(&mut buf, num);
                writer.add_for_new_line(formatted.len());
                writer.print(format_args!(
                    "{}{}{}",
                    pf!("<r><yellow>"),
                    bstr::BStr::new(formatted),
                    pf!("<r>")
                ));
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_custom_formatted_object<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
        ) -> JsResult<()> {
            // Call custom inspect function. Will return the error if there is
            // one; we'll need to pass the callback through to the "this" value
            // in here.
            let result = crate::from_js_host_call(self.global_this, || {
                JSC__JSValue__callCustomInspectFunction(
                    self.global_this,
                    self.custom_formatted_object.function,
                    self.custom_formatted_object.this,
                    u32::from(self.max_depth.saturating_sub(self.depth)),
                    u32::from(self.max_depth),
                    C,
                )
            })?;
            // Strings are printed directly, otherwise we recurse.
            if result.is_string() {
                if writer_
                    .write_fmt(format_args!("{}", result.fmt_string(self.global_this)))
                    .is_err()
                {
                    self.failed = true;
                }
            } else {
                // A custom inspector that returns its own `this` would recurse
                // forever; re-tag without the custom hook so it falls through to
                // default formatting (mirrors util.inspect's `ret !== context`).
                let tag = if result == self.custom_formatted_object.this {
                    Tag::get_advanced(result, self.global_this, TagOptions::DISABLE_INSPECT_CUSTOM)?
                } else {
                    Tag::get(result, self.global_this)?
                };
                self.format::<C>(tag, writer_, result, self.global_this)?;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_symbol<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let description = value.get_description(self.global_this);
            writer.add_for_new_line("Symbol".len());

            if !description.is_empty() {
                writer.add_for_new_line(description.length() + "()".len());
                writer.print(format_args!(
                    "{}Symbol({}){}",
                    pfmt!("<r><blue>", C),
                    description,
                    pfmt!("<r>", C)
                ));
            } else {
                writer.print(format_args!(
                    "{}Symbol(){}",
                    pfmt!("<r><blue>", C),
                    pfmt!("<r>", C)
                ));
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_error<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            // Temporarily remove from the visited map to allow
            // printErrorlikeObject to process it. The circular reference
            // check is already done in print_as, so we know it's safe.
            let was_in_map = if self.map_node.is_some() {
                self.map.remove(&value).is_some()
            } else {
                false
            };

            let mut adapter = bun_io::IoWriterAdapter::new(&mut *writer_);
            let vm = VirtualMachine::get().as_mut();
            vm.print_errorlike_object(value, None, None, self, adapter.interface(), C, false);
            if was_in_map {
                let _ = self.map.insert(value, ());
            }
            Ok(())
        }

        #[inline(never)]
        fn print_class<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
            // Prefer the constructor's own `.name` property over
            // `getClassName` / `calculatedClassName`. For DOM / WebCore
            // InternalFunction constructors like `ReadableStreamBYOBReader`,
            // `calculatedClassName` walks the prototype chain and hits
            // `Function.prototype.constructor === Function`, returning
            // "Function". The `.name` property is set to the real class name
            // on the constructor itself. See #29225.
            let printable = value.get_name(self.global_this)?;
            writer.add_for_new_line(printable.length());

            // Only report `extends` when the parent is itself a class
            // (i.e. `class Foo extends Bar`). Built-in and DOM constructors
            // have `Function.prototype` as their prototype, which would
            // render as `[class X extends Function]` and is noise.
            let proto = value.get_prototype(self.global_this)?;
            let proto_is_class = !proto.is_empty_or_undefined_or_null()
                && proto.is_cell()
                && proto.is_class(self.global_this);
            let printable_proto = if proto_is_class {
                proto.get_name(self.global_this)?
            } else {
                BunString::EMPTY
            };
            writer.add_for_new_line(printable_proto.length());

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
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_function<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
            let printable = value.get_name(self.global_this)?;

            let proto = value.get_prototype(self.global_this)?;
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
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_getter_setter<const C: bool, const CUSTOM: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            // `JSCell` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
            // centralised non-null deref proof (tag only produced for cells).
            let cell = jsc::JSCell::opaque_ref(value.to_cell().expect("GetterSetter is a cell"));
            let (has_getter, has_setter) = if CUSTOM {
                let gs = cell.get_custom_getter_setter();
                (!gs.is_getter_null(), !gs.is_setter_null())
            } else {
                let gs = cell.get_getter_setter();
                (!gs.is_getter_null(), !gs.is_setter_null())
            };
            if has_getter && has_setter {
                writer.print(format_args!(
                    "{}[Getter/Setter]{}",
                    pfmt!("<cyan>", C),
                    pfmt!("<r>", C)
                ));
            } else if has_getter {
                writer.print(format_args!(
                    "{}[Getter]{}",
                    pfmt!("<cyan>", C),
                    pfmt!("<r>", C)
                ));
            } else if has_setter {
                writer.print(format_args!(
                    "{}[Setter]{}",
                    pfmt!("<cyan>", C),
                    pfmt!("<r>", C)
                ));
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_promise<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            if !self.single_line && writer.good_time_for_a_new_line(self.indent) {
                writer.write_all(b"\n");
                writer.write_indent(self.indent);
            }

            writer.write_all(b"Promise { ");
            writer.write_all(pfmt!("<r><cyan>", C).as_bytes());

            // `JSPromise` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
            // centralised non-null deref proof (Tag::Promise ⇒ value is a cell).
            let promise: &JSPromise = JSPromise::opaque_ref(value.encoded() as *const JSPromise);
            match promise.status() {
                jsc::js_promise::Status::Pending => writer.write_all(b"<pending>"),
                jsc::js_promise::Status::Fulfilled => writer.write_all(b"<resolved>"),
                jsc::js_promise::Status::Rejected => writer.write_all(b"<rejected>"),
            }

            writer.write_all(pfmt!("<r>", C).as_bytes());
            writer.write_all(b" }");
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_boolean<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
            if value.is_cell() {
                let bool_name = value.get_class_name(self.global_this)?;
                let bool_value = value.to_js_string_view(self.global_this)?;

                if !bool_name.eq_ascii(b"Boolean") {
                    writer.add_for_new_line(
                        bool_value.length() + bool_name.length() + "[Boolean (): ]".len(),
                    );
                    writer.print(format_args!(
                        "{}[Boolean ({}): {}]{}",
                        pf!("<r><yellow>"),
                        bool_name,
                        bool_value,
                        pf!("<r>")
                    ));
                    if writer.failed {
                        self.failed = true;
                    }
                    return Ok(());
                }
                writer.add_for_new_line(bool_value.length() + "[Boolean: ]".len());
                writer.print(format_args!(
                    "{}[Boolean: {}]{}",
                    pf!("<r><yellow>"),
                    bool_value,
                    pf!("<r>")
                ));
                if writer.failed {
                    self.failed = true;
                }
                return Ok(());
            }
            if value.to_boolean() {
                writer.add_for_new_line(4);
                writer.write_all(pf!("<r><yellow>true<r>").as_bytes());
            } else {
                writer.add_for_new_line(5);
                writer.write_all(pf!("<r><yellow>false<r>").as_bytes());
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_to_json<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            if let Some(func) = value.get(self.global_this, "toJSON")? {
                let result = func.call(self.global_this, value, &[])?;
                let mut scope = self.quoting_keys();
                let this = &mut *scope;
                let tag = Tag::get(result, this.global_this)?;
                return this.format::<C>(tag, writer_, result, this.global_this);
            }

            if writer_.write_all(b"{}").is_err() {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_json<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let str = value.json_stringify(self.global_this, self.indent)?;
            writer.add_for_new_line(str.length());
            if js_type == jsc::JSType::JSDate {
                // in the code for printing dates, it never exceeds this amount
                let mut iso_string_buf = [0u8; 36];
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
                    pfmt!("<r><magenta>", C),
                    bstr::BStr::new(out_buf),
                    pfmt!("<r>", C)
                ));
                if writer.failed {
                    self.failed = true;
                }
                return Ok(());
            }

            writer.print(format_args!("{str}"));
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
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
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }

            let len = value.get_length(self.global_this)?;

            // TODO: DerivedArray does not get passed along in JSType, and it's
            // not clear why.

            if len == 0 {
                writer.write_all(b"[]");
                writer.add_for_new_line(2);
                return Ok(());
            }

            let mut was_good_time = self.always_newline_scope ||
                // heuristic: more than 10, probably should have a newline before it
                len > 10;
            let writer_failed;
            {
                self.indent += 1;
                self.depth += 1;
                let mut scope = self.indented();
                let mut scope = scope.quoting_strings();
                let this = &mut *scope;
                let mut writer = WrappedWriter {
                    ctx: writer_,
                    failed: false,
                    estimated_line_length: &mut this.estimated_line_length,
                };

                writer.add_for_new_line(2);

                let mut empty_start: Option<u32> = None;
                'first: {
                    let element = value.get_direct_index(this.global_this, 0)?;

                    let tag = Tag::get_advanced(element, this.global_this, tag_opts)?;

                    was_good_time = was_good_time
                        || !tag.tag.is_primitive()
                        || writer.good_time_for_a_new_line(this.indent);

                    if !this.single_line && (this.ordered_properties || was_good_time) {
                        writer.reset_line(this.indent);
                        writer.write_all(b"[");
                        writer.write_all(b"\n");
                        writer.write_indent(this.indent);
                        writer.add_for_new_line(1);
                    } else {
                        writer.write_all(b"[ ");
                        writer.add_for_new_line(2);
                    }

                    if element.is_empty() {
                        empty_start = Some(0);
                        break 'first;
                    }

                    this.format::<C>(tag, writer_, element, this.global_this)?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut this.estimated_line_length,
                    };

                    if tag.cell.is_string_like() && C {
                        writer.write_all(pfmt!("<r>", true).as_bytes());
                    }
                }

                let mut i: u32 = 1;
                let mut nonempty_count: u32 = 1;

                while (i as u64) < len {
                    let element = value.get_direct_index(this.global_this, i)?;
                    if element.is_empty() {
                        if empty_start.is_none() {
                            empty_start = Some(i);
                        }
                        if js_type.is_array() {
                            // Skip the whole run of holes at once: probing each
                            // index is O(length), and a sparse array's length
                            // can be 2^32 - 1 with no elements at all.
                            match value.next_present_index(i + 1) {
                                Some(next) if (next as u64) < len => i = next,
                                _ => break,
                            }
                        } else {
                            // Arguments objects store their elements outside
                            // the butterfly; their length is small, so probe
                            // each index like before.
                            i += 1;
                        }
                        continue;
                    }
                    if nonempty_count >= 100 {
                        writer.print_comma::<C>();
                        writer.write_all(b"\n"); // we want the line break to be unconditional here
                        *writer.estimated_line_length = 0;
                        writer.write_indent(this.indent);
                        writer.pretty::<C>(
                            "... N more items".len(),
                            format_args!(
                                "{}... {} more items{}",
                                pf!("<r><d>"),
                                len - u64::from(i),
                                pf!("<r>")
                            ),
                        );
                        break;
                    }
                    nonempty_count += 1;

                    if let Some(empty) = empty_start {
                        if empty > 0 {
                            writer.print_comma::<C>();
                            if !this.single_line
                                && (this.ordered_properties
                                    || writer.good_time_for_a_new_line(this.indent))
                            {
                                was_good_time = true;
                                writer.write_all(b"\n");
                                writer.write_indent(this.indent);
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
                            writer.add_for_new_line(bun_core::fmt::digit_count(empty_count));
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
                    if !this.single_line
                        && (this.ordered_properties || writer.good_time_for_a_new_line(this.indent))
                    {
                        writer.write_all(b"\n");
                        was_good_time = true;
                        writer.write_indent(this.indent);
                    } else {
                        writer.space();
                    }

                    let tag = Tag::get_advanced(element, this.global_this, tag_opts)?;

                    this.format::<C>(tag, writer_, element, this.global_this)?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut this.estimated_line_length,
                    };

                    if tag.cell.is_string_like() && C {
                        writer.write_all(pfmt!("<r>", true).as_bytes());
                    }
                    i += 1;
                }

                if let Some(empty) = empty_start.take() {
                    if empty > 0 {
                        writer.print_comma::<C>();
                        if !this.single_line
                            && (this.ordered_properties
                                || writer.good_time_for_a_new_line(this.indent))
                        {
                            writer.write_all(b"\n");
                            was_good_time = true;
                            writer.write_indent(this.indent);
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
                        writer.add_for_new_line(bun_core::fmt::digit_count(empty_count));
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
                    // Hoist field reads before `formatter: self` reborrows the
                    // whole `*self` (struct-literal field order is not eval
                    // order in the borrow checker's eyes once `self` is moved).
                    let always_newline = !this.single_line
                        && (this.always_newline_scope || this.good_time_for_a_new_line());
                    let single_line = this.single_line;
                    let global_this = this.global_this;
                    let mut iter = PropertyIteratorCtx::<C> {
                        formatter: this,
                        writer: writer_,
                        always_newline,
                        single_line,
                        parent: value,
                        i: i as usize,
                    };
                    value.for_each_property_non_indexed_ctx(global_this, &mut iter)?;
                    if this.failed {
                        return Ok(());
                    }
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut this.estimated_line_length,
                    };
                }
                writer_failed = writer.failed;
            }
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: writer_failed,
                estimated_line_length: &mut self.estimated_line_length,
            };

            if !self.single_line
                && (self.ordered_properties
                    || was_good_time
                    || writer.good_time_for_a_new_line(self.indent))
            {
                writer.reset_line(self.indent);
                writer.write_all(b"\n");
                writer.write_indent(self.indent);
                writer.write_all(b"]");
                writer.reset_line(self.indent);
                writer.add_for_new_line(1);
            } else {
                writer.write_all(b" ]");
                writer.add_for_new_line(2);
            }
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        #[inline(never)]
        fn print_private<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
            remove_before_recurse: &mut bool,
        ) -> JsResult<()> {
            // LAYERING: this needs to downcast over
            // `Response`/`Request`/`Blob`/`S3Client`/`Archive`/`BuildArtifact`/
            // `FetchHeaders`/`TimeoutObject`/`ImmediateObject`/`BuildMessage`/
            // `ResolveMessage`/Jest asymmetric matchers — all of which live in
            // `bun_runtime` (forward-dep). Dispatch through `RuntimeHooks` so
            // the high tier owns the downcasts. Hook returns `true` when it
            // formatted `value`; otherwise we fall through to the generic
            // object printer below.
            if let Some(hooks) = crate::virtual_machine::runtime_hooks() {
                let handled = (hooks.console_print_runtime_object)(self, writer_, value, C)?;
                if handled {
                    return Ok(());
                }
            }

            // `DOMFormData` is a C++-backed WebCore type — no `JsClass` derive,
            // so use its dedicated `from_js` FFI downcast instead of `value.as_`.
            if crate::DOMFormData::from_js(value).is_some() {
                if let Some(to_json_function) = value.get(self.global_this, "toJSON")? {
                    let mut scope = self.quoting_keys();
                    let this = &mut *scope;
                    let result = to_json_function.call(this.global_this, value, &[])?;
                    return this.print_as::<C>(Tag::Object, writer_, result, jsc::JSType::Object);
                }

                // this case should never happen
                return self.print_as::<C>(
                    Tag::Undefined,
                    writer_,
                    JSValue::UNDEFINED,
                    jsc::JSType::Cell,
                );
            } else if js_type != jsc::JSType::DOMWrapper {
                if *remove_before_recurse {
                    *remove_before_recurse = false;
                    let _ = self.map.remove(&value);
                }

                if value.is_callable() {
                    *remove_before_recurse = true;
                    return self.print_as::<C>(Tag::Function, writer_, value, js_type);
                }

                *remove_before_recurse = true;
                return self.print_as::<C>(Tag::Object, writer_, value, js_type);
            }
            if *remove_before_recurse {
                *remove_before_recurse = false;
                let _ = self.map.remove(&value);
            }

            *remove_before_recurse = true;
            self.print_as::<C>(Tag::Object, writer_, value, jsc::JSType::Event)
        }

        #[inline(never)]
        fn print_map_like<const C: bool, const _UNUSED: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let length_value = value
                .get(self.global_this, "size")?
                .unwrap_or_else(|| JSValue::js_number_from_int32(0));
            let length = length_value.coerce_to_i32(self.global_this)?;

            let mut scope = self.quoting_strings();
            let this = &mut *scope;

            let map_name = if value.js_type() == jsc::JSType::WeakMap {
                "WeakMap"
            } else {
                "Map"
            };

            if length == 0 {
                let _ = write!(writer_, "{map_name} {{}}");
                return Ok(());
            }

            if this.single_line {
                let _ = write!(writer_, "{map_name}({length}) {{ ");
            } else {
                let _ = writeln!(writer_, "{map_name}({length}) {{");
            }
            {
                this.indent += 1;
                this.depth = this.depth.saturating_add(1);
                let mut scope = this.indented();
                let this = &mut *scope;
                let global_this = this.global_this;
                if this.single_line {
                    let mut iter = MapIteratorCtx::<C, false, true> {
                        formatter: this,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each_ctx(global_this, &mut iter)?;
                    let count = iter.count;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    if count > 0 {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = MapIteratorCtx::<C, false, false> {
                        formatter: this,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each_ctx(global_this, &mut iter)?;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                }
            }
            if !this.single_line {
                let _ = this.write_indent(writer_);
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        #[inline(never)]
        fn print_map_iterator_like<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            label: &'static str,
        ) -> JsResult<()> {
            let mut scope = self.quoting_strings();
            let this = &mut *scope;

            let _ = write!(writer_, "{label} {{ ");
            {
                this.indent += 1;
                this.depth = this.depth.saturating_add(1);
                let mut scope = this.indented();
                let this = &mut *scope;
                let global_this = this.global_this;
                if this.single_line {
                    let mut iter = MapIteratorCtx::<C, true, true> {
                        formatter: this,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each_ctx(global_this, &mut iter)?;
                    let count = iter.count;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    // Only the MapIterator case writes a trailing space.
                    if count > 0 && label == "MapIterator" {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = MapIteratorCtx::<C, true, false> {
                        formatter: this,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each_ctx(global_this, &mut iter)?;
                    let count = iter.count;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    if count > 0 {
                        let _ = writer_.write_all(b"\n");
                    }
                }
            }
            if !this.single_line {
                let _ = this.write_indent(writer_);
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        #[inline(never)]
        fn print_set<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            let length_value = value
                .get(self.global_this, "size")?
                .unwrap_or_else(|| JSValue::js_number_from_int32(0));
            let length = length_value.coerce_to_i32(self.global_this)?;

            let mut scope = self.quoting_strings();
            let this = &mut *scope;

            let set_name = if value.js_type() == jsc::JSType::WeakSet {
                "WeakSet"
            } else {
                "Set"
            };

            if length == 0 {
                let _ = write!(writer_, "{set_name} {{}}");
                return Ok(());
            }

            if this.single_line {
                let _ = write!(writer_, "{set_name}({length}) {{ ");
            } else {
                let _ = writeln!(writer_, "{set_name}({length}) {{");
            }
            {
                this.indent += 1;
                this.depth = this.depth.saturating_add(1);
                let mut scope = this.indented();
                let this = &mut *scope;
                let global_this = this.global_this;
                if this.single_line {
                    let mut iter = SetIteratorCtx::<C, true> {
                        formatter: this,
                        writer: writer_,
                        is_first: true,
                    };
                    value.for_each_ctx(global_this, &mut iter)?;
                    let is_first = iter.is_first;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    if !is_first {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = SetIteratorCtx::<C, false> {
                        formatter: this,
                        writer: writer_,
                        is_first: true,
                    };
                    value.for_each_ctx(global_this, &mut iter)?;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                }
            }
            if !this.single_line {
                let _ = this.write_indent(writer_);
            }
            let _ = writer_.write_all(b"}");
            Ok(())
        }

        #[inline(never)]
        fn print_event<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            remove_before_recurse: &mut bool,
        ) -> JsResult<()> {
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }

            let event_type_value: JSValue = 'brk: {
                let Some(value_) = value.get(self.global_this, "type")? else {
                    break 'brk JSValue::UNDEFINED;
                };
                if value_.is_string() {
                    break 'brk value_;
                }
                JSValue::UNDEFINED
            };

            // `event_type_value` is a JS string or `undefined` (see break-block
            // above); UNDEFINED → "undefined" → not in MAP → `unknown`.
            let event_type = match EventType::MAP
                .from_js(self.global_this, event_type_value)?
                .unwrap_or(EventType::unknown)
            {
                evt @ (EventType::MessageEvent | EventType::ErrorEvent) => evt,
                _ => {
                    if *remove_before_recurse {
                        let _ = self.map.remove(&value);
                    }
                    // We must potentially remove it again.
                    *remove_before_recurse = true;
                    return self.print_as::<C>(Tag::Object, writer_, value, jsc::JSType::Event);
                }
            };

            // `EventType` is a transparent
            // u8 newtype (non-exhaustive enum), so there is no derived `From<EventType>
            // for &str`; only the two arms above can reach here.
            let event_tag_name: &'static str = match event_type {
                EventType::MessageEvent => "MessageEvent",
                EventType::ErrorEvent => "ErrorEvent",
                _ => unreachable!(),
            };
            let _ = writeln!(
                writer_,
                "{}{}{} {{",
                pf!("<r><cyan>"),
                event_tag_name,
                pf!("<r>")
            );
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let mut scope = self.indented();
                let mut scope = scope.quoting_strings();
                let this = &mut *scope;
                this.write_indent(writer_).expect("unreachable");

                if this.single_line {
                    let _ = write!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{} ",
                        pf!("<r>"),
                        pf!("<green>"),
                        bstr::BStr::new(event_type.label()),
                        pf!("<r>"),
                        pf!("<d>"),
                        pf!("<r>")
                    );
                } else {
                    let _ = writeln!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{}",
                        pf!("<r>"),
                        pf!("<green>"),
                        bstr::BStr::new(event_type.label()),
                        pf!("<r>"),
                        pf!("<d>"),
                        pf!("<r>")
                    );
                }

                if let Some(message_value) =
                    value.fast_get(this.global_this, jsc::BuiltinName::Message)?
                {
                    if message_value.is_string() {
                        if !this.single_line {
                            this.write_indent(writer_).expect("unreachable");
                        }
                        let _ = write!(
                            writer_,
                            "{}message{}:{} ",
                            pf!("<r><blue>"),
                            pf!("<d>"),
                            pf!("<r>")
                        );
                        let tag =
                            Tag::get_advanced(message_value, this.global_this, this.tag_opts())?;
                        this.format::<C>(tag, writer_, message_value, this.global_this)?;
                        if this.failed {
                            return Ok(());
                        }
                        this.print_comma::<C>(writer_).expect("unreachable");
                        if !this.single_line {
                            let _ = writer_.write_all(b"\n");
                        }
                    }
                }

                match event_type {
                    EventType::MessageEvent => {
                        if !this.single_line {
                            this.write_indent(writer_).expect("unreachable");
                        }
                        let _ = write!(
                            writer_,
                            "{}data{}:{} ",
                            pf!("<r><blue>"),
                            pf!("<d>"),
                            pf!("<r>")
                        );
                        let data: JSValue = value
                            .fast_get(this.global_this, jsc::BuiltinName::Data)?
                            .unwrap_or(JSValue::UNDEFINED);
                        let tag = Tag::get_advanced(data, this.global_this, this.tag_opts())?;
                        this.format::<C>(tag, writer_, data, this.global_this)?;
                        if this.failed {
                            return Ok(());
                        }
                        this.print_comma::<C>(writer_).expect("unreachable");
                        if !this.single_line {
                            let _ = writer_.write_all(b"\n");
                        }
                    }
                    EventType::ErrorEvent => {
                        if let Some(error_value) =
                            value.fast_get(this.global_this, jsc::BuiltinName::Error)?
                        {
                            if !this.single_line {
                                this.write_indent(writer_).expect("unreachable");
                            }
                            let _ = write!(
                                writer_,
                                "{}error{}:{} ",
                                pf!("<r><blue>"),
                                pf!("<d>"),
                                pf!("<r>")
                            );
                            let tag =
                                Tag::get_advanced(error_value, this.global_this, this.tag_opts())?;
                            this.format::<C>(tag, writer_, error_value, this.global_this)?;
                            if this.failed {
                                return Ok(());
                            }
                            this.print_comma::<C>(writer_).expect("unreachable");
                            if !this.single_line {
                                let _ = writer_.write_all(b"\n");
                            }
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

        // JSX printing is large (≈230 LOC) and entirely self-contained string
        // formatting over `value.get("type"/"key"/"props"/"children")`
        // (covered by `test/js/bun/util/inspect.test.js` snapshots).
        #[inline(never)]
        fn print_jsx<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
            // Cache once: `disable_inspect_custom` does not change inside this
            // function, and `WrappedWriter` holds `&mut self.estimated_line_length`
            // which prevents calling `&self` methods while it is live.
            let tag_opts = self.tag_opts();
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };

            writer.write_all(pf!("<r>").as_bytes());
            writer.write_all(b"<");

            let mut needs_space: bool;
            let tag_name_view;
            let tag_name_slice: bun_core::Utf8Bytes;
            let mut is_tag_kind_primitive = false;

            if let Some(type_value) = value.get(self.global_this, "type")? {
                let _tag = Tag::get_advanced(type_value, self.global_this, tag_opts)?;

                if _tag.cell == jsc::JSType::Symbol {
                    tag_name_slice = bun_core::Utf8Bytes::EMPTY;
                } else if _tag.cell.is_string_like() {
                    tag_name_view = type_value.to_js_string_view(self.global_this)?;
                    tag_name_slice = tag_name_view.to_utf8();
                    is_tag_kind_primitive = true;
                } else if _tag.cell.is_object() || type_value.is_callable() {
                    let name = type_value.get_name_property(self.global_this)?;
                    tag_name_slice = if name.is_empty() {
                        bun_core::Utf8Bytes::Borrowed(b"NoName")
                    } else {
                        name.into_utf8()
                    };
                } else {
                    tag_name_view = type_value.to_js_string_view(self.global_this)?;
                    tag_name_slice = tag_name_view.to_utf8();
                }

                needs_space = true;
            } else {
                tag_name_slice = bun_core::Utf8Bytes::Borrowed(b"unknown");
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

                    if writer.failed {
                        self.failed = true;
                    }
                    {
                        let mut scope = self.quoting_strings();
                        let this = &mut *scope;
                        this.format::<C>(
                            Tag::get_advanced(key_value, this.global_this, this.tag_opts())?,
                            writer_,
                            key_value,
                            this.global_this,
                        )?;
                    }
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };

                    needs_space = true;
                }
            }

            if let Some(props) = value.get(self.global_this, "props")? {
                let writer_failed = writer.failed;
                let outcome = {
                    let mut scope = self.quoting_strings();
                    let this = &mut *scope;
                    this.print_jsx_props::<C>(
                        writer_,
                        props,
                        tag_opts,
                        needs_space,
                        is_tag_kind_primitive,
                        tag_name_slice.slice(),
                        writer_failed,
                    )?
                };
                let Some(writer_failed) = outcome else {
                    return Ok(());
                };
                writer = WrappedWriter {
                    ctx: writer_,
                    failed: writer_failed,
                    estimated_line_length: &mut self.estimated_line_length,
                };
            }

            writer.write_all(b" />");
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        /// The `props` (and children) half of [`print_jsx`](Self::print_jsx),
        /// run with `quote_strings` set. `None`: the element was closed here;
        /// `Some(failed)`: the caller writes the self-closing tail.
        #[allow(clippy::too_many_arguments)]
        fn print_jsx_props<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            props: JSValue,
            tag_opts: TagOptions,
            mut needs_space: bool,
            is_tag_kind_primitive: bool,
            tag_name_slice: &[u8],
            mut writer_failed: bool,
        ) -> JsResult<Option<bool>> {
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: writer_failed,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let Some(props_obj) = props.get_object() else {
                writer.write_all(b" />");
                if writer.failed {
                    self.failed = true;
                }
                return Ok(None);
            };
            let props_iter = jsc::JSPropertyIterator::init(
                self.global_this,
                props_obj,
                jsc::PropertyIteratorOptions {
                    skip_empty_name: true,
                    include_value: true,
                },
            )?;

            let children_prop = props.get(self.global_this, "children")?;
            writer_failed = writer.failed;
            if props_iter.len > 0 {
                {
                    self.indent += 1;
                    let mut scope = self.scoped(|f| f.indent = f.indent.saturating_sub(1));
                    let this = &mut *scope;
                    let mut writer = WrappedWriter {
                        ctx: writer_,
                        failed: writer_failed,
                        estimated_line_length: &mut this.estimated_line_length,
                    };
                    let count_without_children =
                        props_iter.len - usize::from(children_prop.is_some());

                    while let Some((prop, property_value)) = props_iter.next()? {
                        if prop.eq_ascii(b"children") {
                            continue;
                        }

                        let tag = Tag::get_advanced(property_value, this.global_this, tag_opts)?;

                        if tag.cell.is_hidden() {
                            continue;
                        }

                        if needs_space {
                            writer.space();
                        }
                        needs_space = false;

                        writer.print(format_args!(
                            "{}{}{}={}",
                            pf!("<r><blue>"),
                            prop.trunc(128),
                            pf!("<d>"),
                            pf!("<r>")
                        ));
                        let props_i = props_iter.i.get() as usize;

                        if tag.cell.is_string_like() && C {
                            writer.write_all(pfmt!("<r><green>", true).as_bytes());
                        }

                        if writer.failed {
                            this.failed = true;
                        }
                        this.format::<C>(tag, writer_, property_value, this.global_this)?;
                        writer = WrappedWriter {
                            ctx: writer_,
                            failed: false,
                            estimated_line_length: &mut this.estimated_line_length,
                        };

                        if tag.cell.is_string_like() && C {
                            writer.write_all(pfmt!("<r>", true).as_bytes());
                        }

                        if !this.single_line
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
                            write_indent_n(this.indent, writer.ctx).expect("unreachable");
                        } else if props_i + 1 < count_without_children {
                            writer.space();
                        }
                    }
                    writer_failed = writer.failed;
                }
                let mut writer = WrappedWriter {
                    ctx: writer_,
                    failed: writer_failed,
                    estimated_line_length: &mut self.estimated_line_length,
                };

                if let Some(children) = children_prop {
                    let tag = Tag::get(children, self.global_this)?;

                    let print_children =
                        matches!(tag.tag.tag(), Tag::String | Tag::JSX | Tag::Array);

                    if print_children && !self.single_line {
                        'print_children: {
                            match tag.tag.tag() {
                                Tag::String => {
                                    let children_string =
                                        children.to_js_string_view(self.global_this)?;
                                    if children_string.is_empty() {
                                        break 'print_children;
                                    }
                                    if C {
                                        writer.write_all(pfmt!("<r>", true).as_bytes());
                                    }
                                    writer.write_all(b">");
                                    if children_string.length() < 128 {
                                        writer.write_string(&children_string);
                                    } else {
                                        self.indent += 1;
                                        writer.write_all(b"\n");
                                        write_indent_n(self.indent, writer.ctx)
                                            .expect("unreachable");
                                        self.indent = self.indent.saturating_sub(1);
                                        writer.write_string(&children_string);
                                        writer.write_all(b"\n");
                                        write_indent_n(self.indent, writer.ctx)
                                            .expect("unreachable");
                                    }
                                }
                                Tag::JSX => {
                                    writer.write_all(b">\n");
                                    {
                                        self.indent += 1;
                                        write_indent_n(self.indent, writer.ctx)
                                            .expect("unreachable");
                                        if writer.failed {
                                            self.failed = true;
                                        }
                                        let mut scope =
                                            self.scoped(|f| f.indent = f.indent.saturating_sub(1));
                                        let this = &mut *scope;
                                        this.format::<C>(
                                            Tag::get(children, this.global_this)?,
                                            writer_,
                                            children,
                                            this.global_this,
                                        )?;
                                    }
                                    writer = WrappedWriter {
                                        ctx: writer_,
                                        failed: false,
                                        estimated_line_length: &mut self.estimated_line_length,
                                    };
                                    writer.write_all(b"\n");
                                    write_indent_n(self.indent, writer.ctx).expect("unreachable");
                                }
                                Tag::Array => {
                                    let length = children.get_length(self.global_this)?;
                                    if length == 0 {
                                        break 'print_children;
                                    }
                                    writer.write_all(b">\n");
                                    {
                                        self.indent += 1;
                                        write_indent_n(self.indent, writer.ctx)
                                            .expect("unreachable");
                                        let writer_failed = writer.failed;
                                        let prev_quote_strings = self.quote_strings;
                                        self.quote_strings = false;
                                        let mut scope = self.scoped(move |f| {
                                            f.indent = f.indent.saturating_sub(1);
                                            f.quote_strings = prev_quote_strings;
                                        });
                                        let this = &mut *scope;
                                        let mut writer = WrappedWriter {
                                            ctx: writer_,
                                            failed: writer_failed,
                                            estimated_line_length: &mut this.estimated_line_length,
                                        };

                                        let mut j: usize = 0;
                                        while (j as u64) < length {
                                            let child = children.get_index(
                                                this.global_this,
                                                u32::try_from(j).expect("int cast"),
                                            )?;
                                            if writer.failed {
                                                this.failed = true;
                                            }
                                            this.format::<C>(
                                                Tag::get_advanced(
                                                    child,
                                                    this.global_this,
                                                    this.tag_opts(),
                                                )?,
                                                writer_,
                                                child,
                                                this.global_this,
                                            )?;
                                            writer = WrappedWriter {
                                                ctx: writer_,
                                                failed: false,
                                                estimated_line_length: &mut this
                                                    .estimated_line_length,
                                            };
                                            if (j as u64) + 1 < length {
                                                writer.write_all(b"\n");
                                                write_indent_n(this.indent, writer.ctx)
                                                    .expect("unreachable");
                                            }
                                            j += 1;
                                        }
                                    }
                                    writer = WrappedWriter {
                                        ctx: writer_,
                                        failed: false,
                                        estimated_line_length: &mut self.estimated_line_length,
                                    };
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
                            writer.write_all(tag_name_slice);
                            if C {
                                writer.write_all(pf!("<r>").as_bytes());
                            }
                            writer.write_all(b">");
                        }

                        if writer.failed {
                            self.failed = true;
                        }
                        return Ok(None);
                    }
                }
                writer_failed = writer.failed;
            }
            Ok(Some(writer_failed))
        }

        #[inline(never)]
        fn print_object<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            debug_assert!(value.is_cell());
            let prev_quote_strings = self.quote_strings;
            let prev_always_newline_scope = self.always_newline_scope;
            self.quote_strings = true;
            let mut scope = self.scoped(move |f| {
                f.quote_strings = prev_quote_strings;
                f.always_newline_scope = prev_always_newline_scope;
            });
            let this = &mut *scope;

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
            // Hoist all `this.*` reads before constructing the iterator ctx —
            // `formatter: this` is a `&mut Self` reborrow, so once it's moved
            // into the struct literal we can no longer touch `this` until
            // `iter` is dropped (or via `iter.formatter`).
            let single_line = this.single_line;
            let always_newline =
                !single_line && (this.always_newline_scope || this.good_time_for_a_new_line());
            if this.depth > this.max_depth {
                return this.print_object_depth_exceeded::<C>(writer_, value);
            }
            let ordered_properties = this.ordered_properties;
            let global_this = this.global_this;
            let mut iter = PropertyIteratorCtx::<C> {
                formatter: this,
                writer: writer_,
                always_newline,
                single_line,
                parent: value,
                i: 0,
            };

            if ordered_properties {
                value.for_each_property_ordered_ctx(global_this, &mut iter)?;
            } else {
                value.for_each_property_ctx(global_this, &mut iter)?;
            }

            // Extract what we need from `iter` so its `&mut Formatter` / `&mut writer_`
            // reborrows end here (NLL) and the tail can use `this`/`writer_` again.
            let iter_i = iter.i;
            let iter_always_newline = iter.always_newline;

            if this.failed {
                return Ok(());
            }

            this.print_object_tail::<C>(writer_, value, js_type, iter_i, iter_always_newline)
        }

        #[inline(never)]
        fn print_object_depth_exceeded<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
        ) -> JsResult<()> {
            macro_rules! pf {
                ($s:literal) => {
                    pfmt!($s, C)
                };
            }
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
            Ok(())
        }

        #[inline(never)]
        fn print_object_tail<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
            iter_i: usize,
            iter_always_newline: bool,
        ) -> JsResult<()> {
            if iter_i == 0 {
                if value.is_class(self.global_this) {
                    self.print_as::<C>(Tag::Class, writer_, value, js_type)?;
                } else if value.is_callable() {
                    self.print_as::<C>(Tag::Function, writer_, value, js_type)?;
                } else {
                    if let Some(name_str) = get_object_name(self.global_this, value)? {
                        let _ = write!(writer_, "{name_str} ");
                    }
                    let _ = writer_.write_all(b"{}");
                }
            } else {
                self.depth -= 1;

                if iter_always_newline {
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

        #[inline(never)]
        fn print_typed_array<const C: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            value: JSValue,
            js_type: jsc::JSType,
        ) -> JsResult<()> {
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            let array_buffer = value.as_array_buffer(self.global_this).unwrap();
            let slice = array_buffer.byte_slice();

            if self.format_buffer_as_text
                && js_type == jsc::JSType::Uint8Array
                && bun_core::strings::is_valid_utf8(slice)
            {
                if C {
                    writer.write_all(pfmt!("<r><green>", true).as_bytes());
                }
                let _ = JSPrinter::write_json_string(
                    slice,
                    &mut *writer.ctx,
                    JSPrinter::Encoding::Utf8,
                );
                if C {
                    writer.write_all(pfmt!("<r>", true).as_bytes());
                }
                return Ok(());
            }

            // `ArrayBuffer.typed_array_type` is `JSType` in the Rust
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
                    array_buffer.typed_array_type.typed_array_name()
                },
            );
            if slice.is_empty() {
                writer.print(format_args!("({}) []", array_buffer.len));
                return Ok(());
            }

            writer.print(format_args!("({}) [ ", array_buffer.len));

            use jsc::JSType as T;
            // `slice` comes from a typed array whose backing storage is aligned for its
            // element type (JS spec: typed-array byteOffset is always a multiple of
            // element size, and ArrayBuffer storage is mimalloc-aligned), so the safe
            // `bytemuck::cast_slice` alignment/size checks always pass.
            use bytemuck::cast_slice;
            match js_type {
                T::Int8Array => Self::write_typed_array::<i8, C>(&mut writer, cast_slice(slice)),
                T::Int16Array => Self::write_typed_array::<i16, C>(&mut writer, cast_slice(slice)),
                T::Uint16Array => Self::write_typed_array::<u16, C>(&mut writer, cast_slice(slice)),
                T::Int32Array => Self::write_typed_array::<i32, C>(&mut writer, cast_slice(slice)),
                T::Uint32Array => Self::write_typed_array::<u32, C>(&mut writer, cast_slice(slice)),
                T::Float16Array => {
                    Self::write_typed_array::<bun_core::f16, C>(&mut writer, cast_slice(slice))
                }
                T::Float32Array => {
                    Self::write_typed_array::<f32, C>(&mut writer, cast_slice(slice))
                }
                T::Float64Array => {
                    Self::write_typed_array::<f64, C>(&mut writer, cast_slice(slice))
                }
                T::BigInt64Array => {
                    Self::write_typed_array::<i64, C>(&mut writer, cast_slice(slice))
                }
                T::BigUint64Array => {
                    Self::write_typed_array::<u64, C>(&mut writer, cast_slice(slice))
                }
                // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
                _ => Self::write_typed_array::<u8, C>(&mut writer, slice),
            }

            writer.write_all(b" ]");
            if writer.failed {
                self.failed = true;
            }
            Ok(())
        }

        // associated fn (no `&mut self`) so callers can pass a
        // `WrappedWriter` that already borrows `&mut self.estimated_line_length`
        // without tripping E0499. The only `self` use was `print_comma`, which
        // `WrappedWriter` mirrors.
        fn write_typed_array<N: TypedArrayElement, const C: bool>(
            writer: &mut WrappedWriter<'_>,
            slice: &[N],
        ) {
            // Only the per-element `Display` differs by `N`; the loop is shared.
            Self::write_typed_array_elements::<C>(
                writer,
                slice.len(),
                N::IS_BIGINT,
                &mut |w, i| w.print(format_args!("{}", N::display(slice[i]))),
            );
        }

        fn write_typed_array_elements<const C: bool>(
            writer: &mut WrappedWriter<'_>,
            len: usize,
            is_bigint: bool,
            print_element: &mut dyn FnMut(&mut WrappedWriter<'_>, usize),
        ) {
            let suffix = if is_bigint { "n" } else { "" };
            writer.write_all(pfmt!("<r><yellow>", C).as_bytes());
            print_element(writer, 0);
            writer.print(format_args!("{}{}", suffix, pfmt!("<r>", C)));
            const MAX: usize = 512;
            let shown = len.min(MAX + 1);
            for i in 1..shown {
                writer.print_comma::<C>();
                if writer.failed {
                    return;
                }
                writer.space();

                writer.write_all(pfmt!("<r><yellow>", C).as_bytes());
                print_element(writer, i);
                writer.print(format_args!("{}{}", suffix, pfmt!("<r>", C)));
            }

            if len > MAX + 1 {
                writer.print(format_args!(
                    "{}{}, ... {} more{}",
                    pfmt!("<r><d>", C),
                    suffix,
                    len - MAX - 1,
                    pfmt!("<r>", C),
                ));
            }
        }

        #[inline(always)]
        pub fn format<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            result: TagResult,
            writer: &mut dyn bun_io::Write,
            value: JSValue,
            global_this: &'a JSGlobalObject,
        ) -> JsResult<()> {
            let prev_global_this = self.global_this;
            self.global_this = global_this;

            if let TagPayload::CustomFormattedObject(obj) = result.tag {
                self.custom_formatted_object = obj;
            }
            let result =
                self.print_as::<ENABLE_ANSI_COLORS>(result.tag.tag(), writer, value, result.cell);
            self.global_this = prev_global_this;
            result
        }

        /// Format a single value into `writer`, propagating a JS exception
        /// thrown while inspecting it (e.g. a throwing `[inspect.custom]`).
        /// Use this instead of the `Display` adapter ([`ZigFormatter`]) when a
        /// `JsResult` caller needs the error: `Display` can only report
        /// `fmt::Error`, which panics inside `io::Write::write_fmt` when the
        /// sink itself did not fail.
        pub fn format_value<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            value: JSValue,
            writer: &mut dyn bun_io::Write,
        ) -> JsResult<()> {
            self.stack_check.update();
            let one = [value];
            self.remaining_values = bun_ptr::RawSlice::new(&one);
            let global = self.global_this;
            let result = Tag::get(value, global)
                .and_then(|tag| self.format::<ENABLE_ANSI_COLORS>(tag, writer, value, global));
            self.remaining_values = bun_ptr::RawSlice::EMPTY;
            result
        }
    }

    /// Abstracts over `{d}` vs `{f}` and `n`-suffix for `write_typed_array`.
    trait TypedArrayElement: Copy {
        const IS_BIGINT: bool;
        type Display: core::fmt::Display;
        fn display(self) -> Self::Display;
    }
    macro_rules! int_elem {
        ($($t:ty),*) => { $(
            impl TypedArrayElement for $t {
                const IS_BIGINT: bool = false;
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
        type Display = bun_core::fmt::DoubleFormatter;
        fn display(self) -> Self::Display {
            bun_core::fmt::double(f64::from(self))
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// C-exported entry points (count / time / etc.)
// ───────────────────────────────────────────────────────────────────────────

// HOST_EXPORT(Bun__ConsoleObject__count, jsc)
pub fn count(_console: *mut c_void, global_this: &JSGlobalObject, chars: &[u8]) {
    let hash = bun_wyhash::hash(chars);
    // we don't want to store these strings, it will take too much memory
    let current: u32 = with_console(global_this, |this| {
        let counter = this.counts.get_or_put(hash).expect("unreachable");
        let current: u32 = if counter.found_existing {
            *counter.value_ptr
        } else {
            0
        } + 1;
        *counter.value_ptr = current;
        current
    });

    let writer = console_writer(global_this, false);
    if Output::enable_ansi_colors_stdout() {
        let _ = writeln!(
            writer,
            "{}{}{}: {}{}{}",
            pfmt!("<r>", true),
            bstr::BStr::new(chars),
            pfmt!("<d>", true),
            pfmt!("<r><yellow>", true),
            current,
            pfmt!("<r>", true),
        );
    } else {
        let _ = writeln!(writer, "{}: {}", bstr::BStr::new(chars), current);
    }
    let _ = writer.flush();
}

// HOST_EXPORT(Bun__ConsoleObject__countReset, jsc)
pub fn count_reset(_console: *mut c_void, global_this: &JSGlobalObject, chars: &[u8]) {
    let hash = bun_wyhash::hash(chars);
    // we don't delete it because deleting is implemented via tombstoning
    with_console(global_this, |this| {
        if let Some(v) = this.counts.get_mut(&hash) {
            *v = 0;
        }
    });
}

type PendingTimers = bun_collections::HashMap<u64, Option<bun_core::time::Timer>>;
thread_local! {
    static PENDING_TIME_LOGS: RefCell<PendingTimers> = RefCell::new(PendingTimers::default());
    static PENDING_TIME_LOGS_LOADED: Cell<bool> = const { Cell::new(false) };
}

// HOST_EXPORT(Bun__ConsoleObject__time, jsc)
pub fn time(_console: *mut c_void, _global: &JSGlobalObject, chars: &[u8]) {
    let id = bun_wyhash::hash(chars);
    if !PENDING_TIME_LOGS_LOADED.with(|c| c.get()) {
        PENDING_TIME_LOGS.with_borrow_mut(|m| *m = PendingTimers::default());
        PENDING_TIME_LOGS_LOADED.with(|c| c.set(true));
    }

    PENDING_TIME_LOGS.with_borrow_mut(|map| {
        let result = map.get_or_put(id).expect("unreachable");
        if !result.found_existing || result.value_ptr.is_none() {
            *result.value_ptr = Some(bun_core::time::Timer::start());
        }
    });
}

// HOST_EXPORT(Bun__ConsoleObject__timeEnd, jsc)
pub fn time_end(_console: *mut c_void, _global: &JSGlobalObject, chars: &[u8]) {
    if !PENDING_TIME_LOGS_LOADED.with(|c| c.get()) {
        return;
    }

    let id = bun_wyhash::hash(chars);
    // Replace the slot with `None`, returning the previous value.
    let Some(prev) = PENDING_TIME_LOGS.with_borrow_mut(|m| m.get_mut(&id).map(|slot| slot.take()))
    else {
        return;
    };
    let Some(value) = prev else { return };
    // get the duration in microseconds, then display it in milliseconds
    Output::print_elapsed(
        (value.read() / bun_core::time::NS_PER_US) as f64 / bun_core::time::US_PER_MS as f64,
    );
    match chars.len() {
        0 => Output::print_errorln(format_args!("")),
        _ => Output::print_errorln(format_args!(" {}", bstr::BStr::new(chars))),
    }

    Output::flush();
}

// HOST_EXPORT(Bun__ConsoleObject__timeLog, jsc)
pub fn time_log(_console: *mut c_void, global: &JSGlobalObject, chars: &[u8], args: &[JSValue]) {
    if !PENDING_TIME_LOGS_LOADED.with(|c| c.get()) {
        return;
    }

    let id = bun_wyhash::hash(chars);
    let Some(Some(value)) = PENDING_TIME_LOGS.with_borrow(|m| m.get(&id).copied()) else {
        return;
    };
    // get the duration in microseconds, then display it in milliseconds
    Output::print_elapsed(
        (value.read() / bun_core::time::NS_PER_US) as f64 / bun_core::time::US_PER_MS as f64,
    );
    match chars.len() {
        0 => {}
        _ => Output::print_error(format_args!(" {}", bstr::BStr::new(chars))),
    }
    Output::flush();

    // print the arguments
    // `Formatter` has a `Drop` impl, so struct-update from a
    // temporary is rejected (E0509). Construct via `new()` then mutate.
    let mut fmt = Formatter::new(global);
    fmt.max_depth = bun_options_types::context::try_get()
        .and_then(|ctx| ctx.runtime_options.console_depth)
        .unwrap_or(DEFAULT_CONSOLE_LOG_DEPTH);
    fmt.stack_check = StackCheck::init();
    fmt.can_throw_stack_overflow = true;
    // The `fmt.format(...)` calls below can re-enter JS (and `console.*`);
    // `writer` is the VM console's buffered stderr for the duration.
    let mut writer = console_writer(global, true);
    for &arg in args {
        let Ok(tag) = formatter::Tag::get(arg, global) else {
            return;
        };
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

// JSC's `ConsoleClient` vtable requires these; Bun leaves them unimplemented.

// HOST_EXPORT(Bun__ConsoleObject__profile, jsc)
pub fn profile(_console: *mut c_void, _global: &JSGlobalObject, _chars: &[u8]) {}

// HOST_EXPORT(Bun__ConsoleObject__profileEnd, jsc)
pub fn profile_end(_console: *mut c_void, _global: &JSGlobalObject, _chars: &[u8]) {}

// HOST_EXPORT(Bun__ConsoleObject__takeHeapSnapshot, jsc)
pub fn take_heap_snapshot(_console: *mut c_void, global_this: &JSGlobalObject, _chars: &[u8]) {
    // TODO: this does an extra JSONStringify and we don't need it to!
    let snapshot: [JSValue; 1] = [global_this.generate_heap_snapshot()];
    message_with_type_and_level(
        MessageType::Log,
        MessageLevel::Debug,
        global_this,
        &snapshot,
    );
}

// HOST_EXPORT(Bun__ConsoleObject__timeStamp, jsc)
pub fn time_stamp(
    _console: *mut c_void,
    _global: &JSGlobalObject,
    _args: *mut crate::console_object::ScriptArguments,
) {
}

// HOST_EXPORT(Bun__ConsoleObject__record, jsc)
pub fn record(
    _console: *mut c_void,
    _global: &JSGlobalObject,
    _args: *mut crate::console_object::ScriptArguments,
) {
}

// HOST_EXPORT(Bun__ConsoleObject__recordEnd, jsc)
pub fn record_end(
    _console: *mut c_void,
    _global: &JSGlobalObject,
    _args: *mut crate::console_object::ScriptArguments,
) {
}

// HOST_EXPORT(Bun__ConsoleObject__screenshot, jsc)
pub fn screenshot(
    _console: *mut c_void,
    _global: &JSGlobalObject,
    _args: *mut crate::console_object::ScriptArguments,
) {
}

/// Taking the exhaustive Rust enums by value at the C ABI would be UB on an
/// out-of-range discriminant, so accept the raw `u32` (matching the C++
/// header in `bindings/headers.h`) and clamp via `from_raw`.
// HOST_EXPORT(Bun__ConsoleObject__messageWithTypeAndLevel, jsc)
pub fn message_with_type_and_level_raw(
    _console: *mut c_void,
    message_type: u32,
    level: u32,
    global: &JSGlobalObject,
    vals: &[JSValue],
) {
    message_with_type_and_level(
        MessageType::from_raw(message_type),
        MessageLevel::from_raw(level),
        global,
        vals,
    );
}
