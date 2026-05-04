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
use bun_core::{Environment, Mutex, Output, StackCheck};
use bun_jsc::{
    self as jsc, CallFrame, EventType, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine,
    ZigException, ZigString,
};
use bun_str::{self as strings, String as BunString};

use bun_cli::Command as CLI;
use bun_js_parser::{js_lexer as JSLexer, js_printer as JSPrinter};
use bun_test_runner::pretty_format::JestPrettyFormat;

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
    error_writer_backing: Output::source::stream_type::QuietWriterAdapter,
    writer_backing: Output::source::stream_type::QuietWriterAdapter,

    pub default_indent: u16,

    counts: Counter,
}

impl core::fmt::Display for ConsoleObject {
    fn fmt(&self, _: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Zig: `pub fn format(...) !void {}` — intentionally prints nothing.
        Ok(())
    }
}

impl ConsoleObject {
    // PORT NOTE: out-param constructor reshaped to return `Self` (see PORTING.md
    // "Exception — out-param constructors"). The Zig version writes into
    // `out: *ConsoleObject` so it can take internal pointers to its own
    // buffers; in Rust those become getters, so plain return works.
    pub fn init(
        error_writer: Output::source::StreamType,
        writer: Output::source::StreamType,
    ) -> Self {
        let mut out = ConsoleObject {
            stderr_buffer: [0; 4096],
            stdout_buffer: [0; 4096],
            error_writer_backing: Output::source::stream_type::QuietWriterAdapter::uninit(),
            writer_backing: Output::source::stream_type::QuietWriterAdapter::uninit(),
            default_indent: 0,
            counts: Counter::default(),
        };
        // TODO(port): self-referential buffer wiring — Phase B should make
        // `QuietWriterAdapter` own its 4 KiB buffer instead of borrowing.
        out.error_writer_backing = error_writer.quiet_writer().adapt_to_new_api(&mut out.stderr_buffer);
        out.writer_backing = writer.quiet_writer().adapt_to_new_api(&mut out.stdout_buffer);
        out
    }

    /// Replacement for Zig's self-referential `error_writer: *std.Io.Writer`.
    #[inline]
    pub fn error_writer(&mut self) -> &mut dyn bun_io::Write {
        &mut self.error_writer_backing.new_interface
    }

    /// Replacement for Zig's self-referential `writer: *std.Io.Writer`.
    #[inline]
    pub fn writer(&mut self) -> &mut dyn bun_io::Write {
        &mut self.writer_backing.new_interface
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

static STDERR_MUTEX: Mutex = Mutex::new();
static STDOUT_MUTEX: Mutex = Mutex::new();

thread_local! {
    static STDERR_LOCK_COUNT: Cell<u16> = const { Cell::new(0) };
    static STDOUT_LOCK_COUNT: Cell<u16> = const { Cell::new(0) };
}

/// <https://console.spec.whatwg.org/#formatter>
#[bun_jsc::host_call]
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
        bun_jsc::host_fn::void_from_js_error(err, global);
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
    let console = global.bun_vm().console;
    // `defer console.default_indent +|= (message_type == StartGroup) as u16;`
    let indent_guard = scopeguard::guard((), |_| {
        console.default_indent = console
            .default_indent
            .saturating_add((message_type == MessageType::StartGroup) as u16);
    });

    if message_type == MessageType::StartGroup && len == 0 {
        // undefined is printed if passed explicitly.
        drop(indent_guard);
        return Ok(());
    }

    if message_type == MessageType::EndGroup {
        console.default_indent = console.default_indent.saturating_sub(1);
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
            Output::pretty_fmt!("<r><red>Assertion failed<r>\n", true)
        } else {
            "Assertion failed\n"
        };
        let _ = console.error_writer().write_all(text.as_bytes());
        let _ = console.error_writer().flush();
        drop(indent_guard);
        return Ok(());
    }

    let enable_colors = if matches!(level, MessageLevel::Warning | MessageLevel::Error) {
        Output::enable_ansi_colors_stderr()
    } else {
        Output::enable_ansi_colors_stdout()
    };

    let writer: &mut dyn bun_io::Write = if matches!(level, MessageLevel::Warning | MessageLevel::Error) {
        console.error_writer()
    } else {
        console.writer()
    };

    if let Some(runner) = bun_jsc::Jest::runner() {
        runner.bun_test_root.on_before_print();
    }

    let mut print_length = len;
    // Get console depth from CLI options or bunfig, fallback to default
    let cli_context = CLI::get();
    let console_depth = cli_context
        .runtime_options
        .console_depth
        .unwrap_or(DEFAULT_CONSOLE_LOG_DEPTH);

    let mut print_options = FormatOptions {
        enable_colors,
        add_newline: true,
        flush: true,
        default_indent: console.default_indent,
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
            table_printer.value_formatter.indent += u32::from(console.default_indent);

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
            if let Some(depth_prop) = opts.get(global, "depth")? {
                if depth_prop.is_int32() || depth_prop.is_number() || depth_prop.is_big_int() {
                    print_options.max_depth = depth_prop.to_u16();
                } else if depth_prop.is_null() {
                    print_options.max_depth = u16::MAX;
                }
            }
            if let Some(colors_prop) = opts.get(global, "colors")? {
                if colors_prop.is_boolean() {
                    print_options.enable_colors = colors_prop.to_boolean();
                }
            }
        }
    }

    if print_length > 0 {
        format2(level, global, vals, print_length, writer, print_options)?;
    } else if message_type == MessageType::Log {
        let _ = console.writer().write_all(b"\n");
        let _ = console.writer().flush();
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
            is_iterable: tabular_data.is_iterable(global_object)?,
            jstype: tabular_data.js_type(),
            value_formatter: Formatter {
                remaining_values: &[],
                global_this: global_object,
                ordered_properties: false,
                quote_strings: false,
                single_line: true,
                max_depth: 5,
                can_throw_stack_overflow: true,
                stack_check: StackCheck::init(),
                ..Formatter::new(global_object)
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
    fn write(&mut self, bytes: &[u8]) -> Result<usize, bun_io::Error> {
        *self.width += strings::visible::width::exclude_ansi_colors::utf8(bytes);
        Ok(bytes.len())
    }
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_io::Error> {
        *self.width += strings::visible::width::exclude_ansi_colors::utf8(bytes);
        Ok(())
    }
    fn flush(&mut self) -> Result<(), bun_io::Error> {
        Ok(())
    }
}

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
    ) -> Result<(), bun_io::Error> {
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
                    writer.write_all(Output::pretty_fmt!("<r><b>", true).as_bytes()).ok();
                }
                write!(writer, "{}", col.name).ok();
                if ENABLE_ANSI_COLORS {
                    writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes()).ok();
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
                    cell.to_object(global_object),
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

pub fn write_trace(writer: &mut impl bun_io::Write, global: &JSGlobalObject) {
    let mut holder = ZigException::Holder::init();
    let vm = VirtualMachine::get();
    let _holder_guard = scopeguard::guard(&mut holder, |h| h.deinit(vm));
    let exception = holder.zig_exception();

    let mut source_code_slice: Option<ZigString::Slice> = None;

    let err = ZigString::init(b"trace output").to_error_instance(global);
    err.to_zig_exception(global, exception);
    vm.remap_zig_exception(
        exception,
        err,
        None,
        &mut holder.need_to_clear_parser_arena_on_deinit,
        &mut source_code_slice,
        false,
    );

    if Output::enable_ansi_colors_stderr() {
        let _ = VirtualMachine::print_stack_trace::<true>(writer, &exception.stack);
    } else {
        let _ = VirtualMachine::print_stack_trace::<false>(writer, &exception.stack);
    }
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
                ErrorDisplayLevel::Normal => writer.write_str(Output::pretty_fmt!("<r>", true))?,
                ErrorDisplayLevel::Warn => {
                    writer.write_str(Output::pretty_fmt!("<r><yellow>", true))?
                }
                ErrorDisplayLevel::Full => {
                    writer.write_str(Output::pretty_fmt!("<r><red>", true))?
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
                writer.write_str(Output::pretty_fmt!("<r>", true))?;
            }
            return Ok(());
        }

        if self.enable_colors {
            writer.write_str(Output::pretty_fmt!("<r><d>:<r> ", true))?;
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
        let mut fmt = Formatter {
            remaining_values: &[],
            global_this: global,
            ordered_properties: options.ordered_properties,
            quote_strings: options.quote_strings,
            max_depth: options.max_depth,
            single_line: options.single_line,
            indent: u32::from(options.default_indent),
            stack_check: StackCheck::init(),
            can_throw_stack_overflow: true,
            error_display_level: options.error_display_level,
            ..Formatter::new(global)
        };
        let tag = formatter::Tag::get(vals[0], global)?;
        if fmt.write_indent(writer).is_err() {
            return Ok(());
        }

        if matches!(tag.tag, TagPayload::String) {
            if options.enable_colors {
                if level == MessageLevel::Error {
                    let _ = writer.write_all(Output::pretty_fmt!("<r><red>", true).as_bytes());
                }
                fmt.format::<true>(tag, writer, vals[0], global)?;
                if level == MessageLevel::Error {
                    let _ = writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
                }
            } else {
                fmt.format::<false>(tag, writer, vals[0], global)?;
            }
            if options.add_newline {
                let _ = writer.write_all(b"\n");
            }

            let _ = writer.flush();
        } else {
            let _flush = scopeguard::guard((), |_| {
                if options.flush {
                    let _ = writer.flush();
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

    let _flush = scopeguard::guard((), |_| {
        if options.flush {
            let _ = writer.flush();
        }
    });

    let mut this_value: JSValue = vals[0];
    let mut fmt = Formatter {
        remaining_values: &vals[1..],
        global_this: global,
        ordered_properties: options.ordered_properties,
        quote_strings: options.quote_strings,
        max_depth: options.max_depth,
        single_line: options.single_line,
        indent: u32::from(options.default_indent),
        stack_check: StackCheck::init(),
        can_throw_stack_overflow: true,
        error_display_level: options.error_display_level,
        ..Formatter::new(global)
    };
    let mut tag: formatter::TagResult;

    if fmt.write_indent(writer).is_err() {
        return Ok(());
    }

    let mut any = false;
    if options.enable_colors {
        if level == MessageLevel::Error {
            let _ = writer.write_all(Output::pretty_fmt!("<r><red>", true).as_bytes());
        }
        loop {
            if any {
                let _ = writer.write_all(b" ");
            }
            any = true;

            tag = formatter::Tag::get(this_value, global)?;
            if matches!(tag.tag, TagPayload::String) && !fmt.remaining_values.is_empty() {
                tag.tag = TagPayload::StringPossiblyFormatted;
            }

            fmt.format::<true>(tag, writer, this_value, global)?;
            if fmt.remaining_values.is_empty() {
                break;
            }

            this_value = fmt.remaining_values[0];
            fmt.remaining_values = &fmt.remaining_values[1..];
        }
        if level == MessageLevel::Error {
            let _ = writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
        }
    } else {
        loop {
            if any {
                let _ = writer.write_all(b" ");
            }
            any = true;
            tag = formatter::Tag::get(this_value, global)?;
            if matches!(tag.tag, TagPayload::String) && !fmt.remaining_values.is_empty() {
                tag.tag = TagPayload::StringPossiblyFormatted;
            }

            fmt.format::<false>(tag, writer, this_value, global)?;
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
}

#[derive(Clone, Copy, Default)]
struct CustomFormattedObject {
    function: JSValue,
    this: JSValue,
}

// ───────────────────────────────────────────────────────────────────────────
// Formatter
// ───────────────────────────────────────────────────────────────────────────

pub use formatter::{Formatter, Tag, TagPayload};

pub mod formatter {
    use super::*;

    pub struct Formatter<'a> {
        pub global_this: &'a JSGlobalObject,

        pub remaining_values: &'a [JSValue],
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
                stack_check: StackCheck { cached_stack_end: usize::MAX },
                can_throw_stack_overflow: false,
                error_display_level: ErrorDisplayLevel::Full,
                format_buffer_as_text: false,
            }
        }

        /// Zig copies `Formatter` by value (`var f = this.value_formatter;`).
        // TODO(port): verify which fields need to alias vs copy in Phase B.
        pub(super) fn shallow_clone(&self) -> Self {
            // SAFETY: all fields are POD or `Copy` except `map`/`map_node`; the
            // Zig code intentionally bit-copies them and re-seats `map_node`
            // before drop.
            unsafe { core::ptr::read(self) }
        }
    }

    impl Drop for Formatter<'_> {
        fn drop(&mut self) {
            if let Some(mut node) = self.map_node.take() {
                node.data = core::mem::take(&mut self.map);
                if node.data.capacity() > 512 {
                    node.data.clear_and_free();
                } else {
                    node.data.clear();
                }
                node.release();
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
    pub struct ZigFormatter<'a, 'b> {
        pub formatter: &'a mut Formatter<'b>,
        pub value: JSValue,
    }

    impl core::fmt::Display for ZigFormatter<'_, '_> {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            // TODO(port): Zig writes through `*std.Io.Writer`; here we go
            // through `core::fmt::Write`. Phase B may need a `bun_io::Write`
            // adapter for `core::fmt::Formatter` to keep the byte path.
            let one = [self.value];
            self.formatter.remaining_values = &one;
            let _reset = scopeguard::guard(&mut *self.formatter, |fmt| {
                fmt.remaining_values = &[];
            });
            let tag = Tag::get(self.value, self.formatter.global_this)
                .map_err(|_| core::fmt::Error)?;
            // TODO(port): need a `&mut dyn bun_io::Write` over `f`.
            let mut sink = bun_io::FmtWriteAdapter::new(f);
            self.formatter
                .format::<false>(tag, &mut sink, self.value, self.formatter.global_this)
                .map_err(|_| core::fmt::Error)
        }
    }

    /// For detecting circular references.
    pub mod visited {
        use super::*;
        use bun_collections::pool::ObjectPool;

        pub type Map = bun_collections::HashMap<JSValue, ()>;
        // TODO(port): Zig parameterizes `ObjectPool` with an `init` fn,
        // `threadsafe = true`, and `max_count = 16`. Model as
        // `ObjectPool<Map, 16>` with a `Default`-based init.
        pub type Pool = ObjectPool<Map, 16>;
        pub type PoolNode = <Pool as bun_collections::pool::ObjectPoolTrait>::Node;
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
                if !opts.contains(TagOptions::HIDE_GLOBAL) {
                    return Tag::get(
                        JSValue::c(jsc::C::JSObjectGetProxyTarget(value.as_object_ref())),
                        global_this,
                    );
                }
                return Ok(TagResult { tag: TagPayload::GlobalObject, cell: js_type });
            }

            // Is this a react element?
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
                    let handler = value.get_proxy_internal_field(jsc::ProxyField::Handler);
                    if handler.is_empty() || handler.is_undefined_or_null() {
                        TagPayload::RevokedProxy
                    } else {
                        TagPayload::Proxy
                    }
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

    type CellType = jsc::C::CellType;

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

    impl<'a> Formatter<'a> {
        // TODO(port): Zig parameterizes over `Slice` (`[]const u8` or `[]const u16`)
        // via `comptime Slice: type`. Phase A handles only the `&[u8]` path; the
        // UTF-16 path was unused at the call site (`slice` always comes from
        // `toSlice` → UTF-8).
        fn write_with_formatting<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            writer_: &mut dyn bun_io::Write,
            slice_: &[u8],
            global: &JSGlobalObject,
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
            while i < len {
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
                                i = 0;
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
                        let next_value = self.remaining_values[0];
                        self.remaining_values = &self.remaining_values[1..];

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
                                    self.add_for_new_line("NaN".len());
                                    writer.print(format_args!("NaN"));
                                    i += 1;
                                    continue;
                                };

                                if int < i64::from(u32::MAX) {
                                    let is_negative = int < 0;
                                    let digits = if i != 0 {
                                        bun_core::fmt::fast_digit_count(int.unsigned_abs())
                                            + (is_negative as u64)
                                    } else {
                                        1
                                    };
                                    self.add_for_new_line(digits as usize);
                                } else {
                                    self.add_for_new_line(bun_core::fmt::count_int(int));
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
                                        self.add_for_new_line(digits as usize);
                                        writer.print(format_args!("{int}"));
                                        i += 1;
                                        continue;
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
                                    self.add_for_new_line(bun_core::fmt::count_float(converted));
                                    writer.print(format_args!("{converted}"));
                                } else if converted.is_nan() {
                                    self.add_for_new_line("NaN".len());
                                    writer.write_all(b"NaN");
                                } else if converted.is_infinite() {
                                    self.add_for_new_line(
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
                                    self.add_for_new_line(formatted.len());
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
                                self.add_for_new_line(str.length());
                                writer.print(format_args!("{str}"));
                                str.deref_();
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

    /// Zig: `fn WrappedWriter(comptime Writer: type) type`. We collapse the
    /// generic over `*std.Io.Writer` into `&mut dyn bun_io::Write`.
    // PERF(port): was comptime monomorphization (`fn WrappedWriter(comptime Writer: type) type`) — profile in Phase B
    pub struct WrappedWriter<'w> {
        pub ctx: &'w mut dyn bun_io::Write,
        pub failed: bool,
        pub estimated_line_length: &'w mut usize,
    }

    impl<'w> WrappedWriter<'w> {
        pub const IS_WRAPPED_WRITER: bool = true;

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
                if let Some(i) = strings::first_non_ascii(remain) {
                    if i > 0 {
                        if self.ctx.write_all(&remain[0..i as usize]).is_err() {
                            self.failed = true;
                            return;
                        }
                    }
                    if self
                        .ctx
                        .write_all(&strings::latin1_to_codepoint_bytes_assume_not_ascii(
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
            if bun_core::fmt::format_utf16_type(input, self.ctx).is_err() {
                self.failed = true;
            }
        }
    }

    const INDENTATION_BUF: [u8; 64] = [b' '; 64];

    impl Formatter<'_> {
        pub fn write_indent(
            &self,
            writer: &mut dyn bun_io::Write,
        ) -> Result<(), bun_io::Error> {
            let mut total_remain: u32 = self.indent;
            while total_remain > 0 {
                let written: u8 = total_remain.min(32) as u8;
                writer.write_all(&INDENTATION_BUF[0..(written as usize) * 2])?;
                total_remain = total_remain.saturating_sub(u32::from(written));
            }
            Ok(())
        }

        pub fn print_comma<const ENABLE_ANSI_COLORS: bool>(
            &mut self,
            writer: &mut dyn bun_io::Write,
        ) -> Result<(), bun_io::Error> {
            writer.write_all(Output::pretty_fmt!("<r><d>,<r>", ENABLE_ANSI_COLORS).as_bytes())?;
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
                        Output::pretty_fmt!("<r>", C),
                        key,
                        Output::pretty_fmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16_bit()
                    && (!this.quote_keys
                        && JSLexer::is_latin1_identifier_u16(key.utf16_slice_aligned()))
                {
                    this.add_for_new_line(key.len + 1);
                    writer.print(format_args!(
                        concat!("{}", "{}", "{}"),
                        Output::pretty_fmt!("<r>", C),
                        key,
                        Output::pretty_fmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16_bit() {
                    let mut utf16_slice = key.utf16_slice_aligned();

                    this.add_for_new_line(utf16_slice.len() + 2);

                    if C {
                        writer.write_all(Output::pretty_fmt!("<r><green>", true).as_bytes());
                    }

                    writer.write_all(b"\"");

                    while let Some(j) = strings::index_of_any16(utf16_slice, b"\"") {
                        writer.write_16_bit(&utf16_slice[0..j]);
                        writer.write_all(b"\"");
                        utf16_slice = &utf16_slice[j + 1..];
                    }

                    writer.write_16_bit(utf16_slice);

                    writer.print(format_args!(
                        "{}",
                        Output::pretty_fmt!("\"<r><d>:<r> ", C)
                    ));
                } else {
                    this.add_for_new_line(key.len + 2);

                    writer.print(format_args!(
                        "{}{}{}",
                        Output::pretty_fmt!("<r><green>", C),
                        bun_core::fmt::format_json_string_latin1(key.slice()),
                        Output::pretty_fmt!("<r><d>:<r> ", C),
                    ));
                }
            } else if cfg!(debug_assertions) && is_private_symbol {
                this.add_for_new_line(1 + "$:".len() + key.len);
                writer.print(format_args!(
                    "{}{}{}{}",
                    Output::pretty_fmt!("<r><magenta>", C),
                    if key.len > 0 && key.char_at(0) == u32::from(b'#') { "" } else { "$" },
                    key,
                    Output::pretty_fmt!("<r><d>:<r> ", C),
                ));
            } else {
                this.add_for_new_line(1 + "[Symbol()]:".len() + key.len);
                writer.print(format_args!(
                    "{}Symbol({}){}",
                    Output::pretty_fmt!("<r><d>[<r><blue>", C),
                    key,
                    Output::pretty_fmt!("<r><d>]:<r> ", C),
                ));
            }

            if tag.cell.is_string_like() {
                if C {
                    writer.write_all(Output::pretty_fmt!("<r><green>", true).as_bytes());
                }
            }

            let _ = this.format::<C>(tag, ctx.writer, value, global_this);

            if tag.cell.is_string_like() {
                if C {
                    writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
                }
            }
        }
    }

    fn get_object_name(
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<ZigString>> {
        let mut name_str = ZigString::init(b"");
        value.get_class_name(global_this, &mut name_str)?;
        if !name_str.eql_comptime(b"Object") {
            return Ok(Some(name_str));
        } else if value.get_prototype(global_this).eql_value(JSValue::NULL) {
            return Ok(Some(*ZigString::static_("[Object: null prototype]")));
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
    }

    // ───────────────────────────────────────────────────────────────────────
    // print_as — the big tag-dispatched printer
    // ───────────────────────────────────────────────────────────────────────

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
            let _writer_failed = scopeguard::guard((), |_| {
                // The original `defer` copies `writer.failed` → `self.failed`;
                // because of the reseat dance above we mirror it at each
                // `reseat_writer!()` site and once more on every return path.
            });

            if FORMAT.can_have_circular_references() {
                if !self.stack_check.is_safe_to_recurse() {
                    self.failed = true;
                    if self.can_throw_stack_overflow {
                        return Err(self.global_this.throw_stack_overflow());
                    }
                    return Ok(());
                }

                if self.map_node.is_none() {
                    let mut node = visited::Pool::get();
                    node.data.clear();
                    self.map = core::mem::take(&mut node.data);
                    self.map_node = Some(node);
                }

                let entry = self.map.get_or_put(value).expect("unreachable");
                if entry.found_existing {
                    writer.write_all(
                        Output::pretty_fmt!("<r><cyan>[Circular]<r>", ENABLE_ANSI_COLORS).as_bytes(),
                    );
                    return Ok(());
                } else {
                    remove_before_recurse = true;
                }
            }

            let _circular_cleanup = scopeguard::guard((), |_| {
                if FORMAT.can_have_circular_references() && remove_before_recurse {
                    let _ = self.map.remove(&value);
                }
            });

            // Helper macro: `Output::pretty_fmt!(fmt, ENABLE_ANSI_COLORS)`.
            macro_rules! pf {
                ($s:literal) => {
                    Output::pretty_fmt!($s, ENABLE_ANSI_COLORS)
                };
            }

            match FORMAT {
                Tag::StringPossiblyFormatted => {
                    let str = value.to_slice(self.global_this)?;
                    self.add_for_new_line(str.len);
                    let slice = str.slice();
                    reseat_writer!();
                    self.write_with_formatting::<ENABLE_ANSI_COLORS>(writer_, slice, self.global_this)?;
                }
                Tag::String => {
                    // This is called from the '%s' formatter, so it can actually be any value
                    let str: BunString = BunString::from_js(value, self.global_this)?;
                    self.add_for_new_line(str.length());

                    if self.quote_strings && js_type != jsc::JSType::RegExpObject {
                        if str.is_empty() {
                            writer.write_all(b"\"\"");
                            return Ok(());
                        }

                        if ENABLE_ANSI_COLORS {
                            writer.write_all(Output::pretty_fmt!("<r><green>", true).as_bytes());
                        }
                        let _reset = scopeguard::guard((), |_| {
                            if ENABLE_ANSI_COLORS {
                                writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
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
                        let _reset = scopeguard::guard((), |_| {
                            if ENABLE_ANSI_COLORS {
                                writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
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
                        let buf = strings::allocate_latin1_into_utf8(str.latin1())
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
                    let int = value.coerce_i64(self.global_this)?;
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
                    // SAFETY: FFI call; global_this is a valid JSGlobalObject pointer for the call's duration.
                    let result = bun_jsc::from_js_host_call(self.global_this, || unsafe {
                        JSC__JSValue__callCustomInspectFunction(
                            self.global_this as *const _ as *mut _,
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
                    let _restore = scopeguard::guard((), |_| {
                        if was_in_map {
                            let _ = self.map.insert(value, ());
                        }
                    });

                    reseat_writer!();
                    VirtualMachine::get().print_errorlike_object::<ENABLE_ANSI_COLORS>(
                        value, None, None, self, writer_, false,
                    );
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
                    let cell = value.as_cell();
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
                    let cell = value.as_cell();
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
                        unsafe { &*(value.as_object_ref().unwrap() as *const JSPromise) };
                    match promise.status() {
                        jsc::PromiseStatus::Pending => writer.write_all(b"<pending>"),
                        jsc::PromiseStatus::Fulfilled => writer.write_all(b"<resolved>"),
                        jsc::PromiseStatus::Rejected => writer.write_all(b"<rejected>"),
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
                        Output::pretty_fmt!(concat!("<cyan>", "[Global Object]", "<r>"), ENABLE_ANSI_COLORS)
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
                                self.global_this.clear_exception();
                            }
                            Ok(result) => {
                                let prev_quote_keys = self.quote_keys;
                                self.quote_keys = true;
                                let _r = scopeguard::guard((), |_| self.quote_keys = prev_quote_keys);
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
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };
            macro_rules! pf { ($s:literal) => { Output::pretty_fmt!($s, C) }; }

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
                let _depth = scopeguard::guard(&mut self.depth, |d| *d = d.saturating_sub(1));
                let _indent = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));

                self.add_for_new_line(2);

                let prev_quote_strings = self.quote_strings;
                self.quote_strings = true;
                let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = prev_quote_strings);
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
                        writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
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

                    let tag = Tag::get_advanced(element, self.global_this, self.tag_opts())?;

                    drop(writer);
                    self.format::<C>(tag, writer_, element, self.global_this)?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };

                    if tag.cell.is_string_like() && C {
                        writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
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
            // `bun_jsc::JsClass::from_js`. The list of types is preserved.
            macro_rules! pf { ($s:literal) => { Output::pretty_fmt!($s, C) }; }
            let mut writer = WrappedWriter {
                ctx: writer_,
                failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };

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
                    let _r = scopeguard::guard(&mut self.quote_keys, move |q| *q = prev_quote_keys);

                    let result = to_json_function
                        .call(self.global_this, value, &[])
                        .unwrap_or_else(|err| self.global_this.take_exception(err));
                    return self.print_as::<{ Tag::Object }, C>(writer_, result, jsc::JSType::Object);
                }
            } else if value.as_::<bun_jsc::DOMFormData>().is_some() {
                if let Some(to_json_function) = value.get(self.global_this, "toJSON")? {
                    let prev_quote_keys = self.quote_keys;
                    self.quote_keys = true;
                    let _r = scopeguard::guard(&mut self.quote_keys, move |q| *q = prev_quote_keys);

                    let result = to_json_function
                        .call(self.global_this, value, &[])
                        .unwrap_or_else(|err| self.global_this.take_exception(err));
                    return self.print_as::<{ Tag::Object }, C>(writer_, result, jsc::JSType::Object);
                }

                // this case should never happen
                return self
                    .print_as::<{ Tag::Undefined }, C>(writer_, JSValue::UNDEFINED, jsc::JSType::Cell);
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
            let length = length_value.coerce_i32(self.global_this)?;

            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = prev_quote_strings);

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
                let _i = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));
                let _d = scopeguard::guard(&mut self.depth, |d| *d = d.saturating_sub(1));
                // PERF(port): was comptime bool dispatch on single_line — profile in Phase B
                if self.single_line {
                    let mut iter = MapIteratorCtx::<C, false, true> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(self.global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, false, true>::for_each)?;
                    if self.failed { return Ok(()); }
                    if iter.count > 0 { let _ = writer_.write_all(b" "); }
                } else {
                    let mut iter = MapIteratorCtx::<C, false, false> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(self.global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, false, false>::for_each)?;
                    if self.failed { return Ok(()); }
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
            let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = prev_quote_strings);

            let _ = write!(writer_, "{label} {{ ");
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let _i = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));
                let _d = scopeguard::guard(&mut self.depth, |d| *d = d.saturating_sub(1));
                if self.single_line {
                    let mut iter = MapIteratorCtx::<C, true, true> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(self.global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, true, true>::for_each)?;
                    if self.failed { return Ok(()); }
                    if iter.count > 0 {
                        let _ = writer_.write_all(if label == "MapIterator" { b" " } else { b" " });
                    }
                } else {
                    let mut iter = MapIteratorCtx::<C, true, false> {
                        formatter: self, writer: writer_, count: 0,
                    };
                    value.for_each(self.global_this, &mut iter as *mut _ as *mut c_void,
                        MapIteratorCtx::<C, true, false>::for_each)?;
                    if self.failed { return Ok(()); }
                    if iter.count > 0 {
                        let _ = writer_.write_all(b"\n");
                    }
                }
                // TODO(port): Zig's SetIterator branch differed slightly: it
                // wrote `\n` only when `!single_line && count > 0`, and a
                // single-line trailing space only for MapIterator. Reconcile
                // exactly in Phase B by re-splitting into two helpers if
                // snapshot tests diverge.
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
            let length = length_value.coerce_i32(self.global_this)?;

            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = prev_quote_strings);

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
                let _i = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));
                let _d = scopeguard::guard(&mut self.depth, |d| *d = d.saturating_sub(1));
                if self.single_line {
                    let mut iter = SetIteratorCtx::<C, true> {
                        formatter: self, writer: writer_, is_first: true,
                    };
                    value.for_each(self.global_this, &mut iter as *mut _ as *mut c_void,
                        SetIteratorCtx::<C, true>::for_each)?;
                    if self.failed { return Ok(()); }
                    if !iter.is_first { let _ = writer_.write_all(b" "); }
                } else {
                    let mut iter = SetIteratorCtx::<C, false> {
                        formatter: self, writer: writer_, is_first: true,
                    };
                    value.for_each(self.global_this, &mut iter as *mut _ as *mut c_void,
                        SetIteratorCtx::<C, false>::for_each)?;
                    if self.failed { return Ok(()); }
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
            macro_rules! pf { ($s:literal) => { Output::pretty_fmt!($s, C) }; }

            let event_type_value: JSValue = 'brk: {
                let Some(value_) = value.get(self.global_this, "type")? else {
                    break 'brk JSValue::UNDEFINED;
                };
                if value_.is_string() {
                    break 'brk value_;
                }
                JSValue::UNDEFINED
            };

            let event_type = match EventType::map()
                .from_js(self.global_this, event_type_value)?
                .unwrap_or(EventType::Unknown)
            {
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

            let _ = write!(
                writer_,
                "{}{}{} {{\n",
                pf!("<r><cyan>"),
                <&'static str>::from(event_type),
                pf!("<r>")
            );
            {
                self.indent += 1;
                self.depth = self.depth.saturating_add(1);
                let _i = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));
                let _d = scopeguard::guard(&mut self.depth, |d| *d = d.saturating_sub(1));
                let old_quote_strings = self.quote_strings;
                self.quote_strings = true;
                let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = old_quote_strings);
                self.write_indent(writer_).expect("unreachable");

                if self.single_line {
                    let _ = write!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{} ",
                        pf!("<r>"), pf!("<green>"), event_type.label(), pf!("<r>"), pf!("<d>"), pf!("<r>")
                    );
                } else {
                    let _ = write!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{}\n",
                        pf!("<r>"), pf!("<green>"), event_type.label(), pf!("<r>"), pf!("<d>"), pf!("<r>")
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
            macro_rules! pf { ($s:literal) => { Output::pretty_fmt!($s, C) }; }
            let mut writer = WrappedWriter {
                ctx: writer_, failed: false,
                estimated_line_length: &mut self.estimated_line_length,
            };

            writer.write_all(pf!("<r>").as_bytes());
            writer.write_all(b"<");

            let mut needs_space = false;
            let mut tag_name_str = ZigString::init(b"");

            let mut tag_name_slice: ZigString::Slice = ZigString::Slice::empty();
            let mut is_tag_kind_primitive = false;

            let _tag_name_guard = scopeguard::guard(&mut tag_name_slice, |s| {
                if s.is_allocated() { s.deinit(); }
            });

            if let Some(type_value) = value.get(self.global_this, "type")? {
                let _tag = Tag::get_advanced(type_value, self.global_this, self.tag_opts())?;

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
                    let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = old_quote_strings);

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
                let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = prev_quote_strings);
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
                        let _ind = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));
                        let count_without_children =
                            props_iter.len - usize::from(children_prop.is_some());

                        while let Some(prop) = props_iter.next()? {
                            if prop.eql_comptime(b"children") {
                                continue;
                            }

                            let property_value = props_iter.value;
                            let tag = Tag::get_advanced(property_value, self.global_this, self.tag_opts())?;

                            if tag.cell.is_hidden() { continue; }

                            if needs_space { writer.space(); }
                            needs_space = false;

                            writer.print(format_args!(
                                "{}{}{}={}",
                                pf!("<r><blue>"),
                                prop.trunc(128),
                                pf!("<d>"),
                                pf!("<r>")
                            ));

                            if tag.cell.is_string_like() && C {
                                writer.write_all(Output::pretty_fmt!("<r><green>", true).as_bytes());
                            }

                            drop(writer);
                            self.format::<C>(tag, writer_, property_value, self.global_this)?;
                            writer = WrappedWriter {
                                ctx: writer_, failed: false,
                                estimated_line_length: &mut self.estimated_line_length,
                            };

                            if tag.cell.is_string_like() && C {
                                writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
                            }

                            if !self.single_line
                                && (
                                    // count_without_children is necessary to prevent
                                    // printing an extra newline if there are children
                                    // and one prop and the child prop is the last prop
                                    props_iter.i + 1 < count_without_children
                                    // 3 is arbitrary but basically
                                    //  <input type="text" value="foo" />
                                    //  ^ should be one line
                                    // <input type="text" value="foo" bar="true" baz={false} />
                                    //  ^ should be multiple lines
                                    && props_iter.i > 3
                                )
                            {
                                writer.write_all(b"\n");
                                self.write_indent(writer.ctx).expect("unreachable");
                            } else if props_iter.i + 1 < count_without_children {
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
                                            writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
                                        }
                                        writer.write_all(b">");
                                        if children_string.len < 128 {
                                            writer.write_string(&children_string);
                                        } else {
                                            self.indent += 1;
                                            writer.write_all(b"\n");
                                            self.write_indent(writer.ctx).expect("unreachable");
                                            self.indent = self.indent.saturating_sub(1);
                                            writer.write_string(&children_string);
                                            writer.write_all(b"\n");
                                            self.write_indent(writer.ctx).expect("unreachable");
                                        }
                                    }
                                    Tag::JSX => {
                                        writer.write_all(b">\n");
                                        {
                                            self.indent += 1;
                                            self.write_indent(writer.ctx).expect("unreachable");
                                            let _ind = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));
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
                                        self.write_indent(writer.ctx).expect("unreachable");
                                    }
                                    Tag::Array => {
                                        let length = children.get_length(self.global_this)?;
                                        if length == 0 { break 'print_children; }
                                        writer.write_all(b">\n");
                                        {
                                            self.indent += 1;
                                            self.write_indent(writer.ctx).expect("unreachable");
                                            let _prev_quote_strings = self.quote_strings;
                                            self.quote_strings = false;
                                            let _qs2 = scopeguard::guard(&mut self.quote_strings, move |q| *q = _prev_quote_strings);
                                            let _ind = scopeguard::guard(&mut self.indent, |i| *i = i.saturating_sub(1));

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
                                                    self.write_indent(writer.ctx).expect("unreachable");
                                                }
                                                j += 1;
                                            }
                                        }
                                        writer.write_all(b"\n");
                                        self.write_indent(writer.ctx).expect("unreachable");
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
            macro_rules! pf { ($s:literal) => { Output::pretty_fmt!($s, C) }; }
            debug_assert!(value.is_cell());
            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = scopeguard::guard(&mut self.quote_strings, move |q| *q = prev_quote_strings);

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
            let _ans = scopeguard::guard(&mut self.always_newline_scope, move |a| {
                *a = prev_always_newline_scope;
            });
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
                && strings::is_valid_utf8(slice)
            {
                if C {
                    writer.write_all(Output::pretty_fmt!("<r><green>", true).as_bytes());
                }
                let _ = JSPrinter::write_json_string(slice, writer_, JSPrinter::Encoding::Utf8);
                if C {
                    writer.write_all(Output::pretty_fmt!("<r>", true).as_bytes());
                }
                return Ok(());
            }

            writer.write_all(
                if array_buffer.typed_array_type == jsc::TypedArrayType::Uint8Array
                    && array_buffer.value.is_buffer(self.global_this)
                {
                    b"Buffer"
                } else if array_buffer.typed_array_type == jsc::TypedArrayType::ArrayBuffer
                    && array_buffer.shared
                {
                    b"SharedArrayBuffer"
                } else {
                    <&'static str>::from(array_buffer.typed_array_type).as_bytes()
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
                Output::pretty_fmt!("<r><yellow>", C),
                N::display(slice[0]),
                if N::IS_BIGINT { "n" } else { "" },
                Output::pretty_fmt!("<r>", C),
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
                    Output::pretty_fmt!("<r><yellow>", C),
                    N::display(el),
                    if N::IS_BIGINT { "n" } else { "" },
                    Output::pretty_fmt!("<r>", C),
                ));
            }

            if slice.len() > MAX + 1 {
                writer.print(format_args!(
                    "{}{}, ... {} more{}",
                    Output::pretty_fmt!("<r><d>", C),
                    if N::IS_BIGINT { "n" } else { "" },
                    slice.len() - MAX - 1,
                    Output::pretty_fmt!("<r>", C),
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
            let _restore = scopeguard::guard(&mut self.global_this, move |g| *g = prev_global_this);
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
    // TODO(port): impl TypedArrayElement for bun_core::f16 once that type lands.
}

// ───────────────────────────────────────────────────────────────────────────
// C-exported entry points (count / time / etc.)
// ───────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__count(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) {
    let this = global_this.bun_vm().console;
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
            Output::pretty_fmt!("<r>", true),
            bstr::BStr::new(slice),
            Output::pretty_fmt!("<d>", true),
            Output::pretty_fmt!("<r><yellow>", true),
            current,
            Output::pretty_fmt!("<r>", true),
            "",
        );
    } else {
        let _ = write!(writer, "{}: {}\n", bstr::BStr::new(slice), current);
    }
    let _ = writer.flush();
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__countReset(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) {
    let this = global_this.bun_vm().console;
    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    let hash = bun_wyhash::hash(slice);
    // we don't delete it because deleting is implemented via tombstoning
    let Some(entry) = this.counts.get_entry(hash) else { return };
    *entry.value_ptr = 0;
}

type PendingTimers = bun_collections::HashMap<u64, Option<bun_core::time::Timer>>;
thread_local! {
    static PENDING_TIME_LOGS: RefCell<PendingTimers> = RefCell::new(PendingTimers::default());
    static PENDING_TIME_LOGS_LOADED: Cell<bool> = const { Cell::new(false) };
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
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
#[bun_jsc::host_call]
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
    let Some(result) = PENDING_TIME_LOGS.with_borrow_mut(|m| m.fetch_put(id, None).ok().flatten())
    else {
        return;
    };
    let Some(mut value) = result.value else { return };
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
#[bun_jsc::host_call]
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
    let Some(Some(mut value)) = PENDING_TIME_LOGS.with_borrow(|m| m.get(&id).copied()) else {
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
    let mut fmt = Formatter {
        remaining_values: &[],
        global_this: global,
        ordered_properties: false,
        quote_strings: false,
        max_depth: {
            let cli_context = CLI::get();
            cli_context
                .runtime_options
                .console_depth
                .unwrap_or(DEFAULT_CONSOLE_LOG_DEPTH)
        },
        stack_check: StackCheck::init(),
        can_throw_stack_overflow: true,
        ..Formatter::new(global)
    };
    let console = global.bun_vm().console;
    let writer = console.error_writer();
    // SAFETY: caller passes a valid (args, args_len) pair.
    for &arg in unsafe { core::slice::from_raw_parts(args, args_len) } {
        let Ok(tag) = formatter::Tag::get(arg, global) else { return };
        let _ = writer.write_all(b" ");
        if Output::enable_ansi_colors_stderr() {
            let _ = fmt.format::<true>(tag, writer, arg, global);
        } else {
            let _ = fmt.format::<false>(tag, writer, arg, global);
        }
    }
    let _ = writer.write_all(b"\n");
    let _ = writer.flush();
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__profile(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__profileEnd(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__takeHeapSnapshot(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
    // TODO: this does an extra JSONStringify and we don't need it to!
    let snapshot: [JSValue; 1] = [global_this.generate_heap_snapshot()];
    message_with_type_and_level(
        core::ptr::null_mut(), // Zig passes `undefined` here
        MessageType::Log,
        MessageLevel::Debug,
        global_this,
        snapshot.as_ptr(),
        1,
    );
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__timeStamp(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__record(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__recordEnd(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__screenshot(
    _console: *mut ConsoleObject,
    _global: &JSGlobalObject,
    _args: *mut ScriptArguments,
) {
}

#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub extern "C" fn Bun__ConsoleObject__messageWithTypeAndLevel(
    ctype: *mut ConsoleObject,
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) {
    message_with_type_and_level(ctype, message_type, level, global, vals, len);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ConsoleObject.zig (3833 lines)
//   confidence: low
//   todos:      14
//   notes:      Heavy borrowck reshaping around WrappedWriter (borrows self.estimated_line_length); print_as arms hoisted to helpers; Output::pretty_fmt! assumed macro; self-ref writer fields restructured as getters per LIFETIMES.tsv; const-generic Tag dispatch needs ConstParamTy; f16 path stubbed.
// ──────────────────────────────────────────────────────────────────────────
