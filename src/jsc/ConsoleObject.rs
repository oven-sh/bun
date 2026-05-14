//! Port of `src/jsc/ConsoleObject.zig`.
//!
//! Implements `console.*` printing for the Bun runtime: type-tag dispatch,
//! recursive value formatting, table printing, `%`-format specifier handling,
//! `console.count`/`time`/`timeEnd`, and the C ABI shims that JavaScriptCore
//! calls into.

use crate::{ComptimeStringMapExt as _, ZigStringJsc as _};
use bun_io::Write as _;
use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::fmt::Write as _;

use crate as jsc;
use crate::virtual_machine::VirtualMachine;
use crate::{
    CallFrame, EventType, JSGlobalObject, JSPromise, JSValue, JsResult, ZigException, ZigString,
};
use bun_collections::HashMap;
use bun_core::{Environment, Output, StackCheck};
use bun_core::{OwnedString, String as BunString, strings};

/// Thin facade over `bun_js_parser::lexer` / `bun_js_printer` so the call
/// sites below keep their Zig spelling (`JSLexer.isLatin1Identifier`,
/// `JSPrinter.writeJsonString`) while the underlying crates expose slightly
/// different shapes (single generic identifier predicate; const-generic
/// encoding on `write_json_string`).
mod JSLexer {
    #[inline]
    pub fn is_latin1_identifier_u8(name: &[u8]) -> bool {
        bun_ast::lexer_tables::is_latin1_identifier(name)
    }
    /// Zig `isLatin1Identifier(comptime []const u16, name)` — same predicate
    /// over a UTF-16 slice. Canonical impl lives next to the u8 overload in
    /// `bun_js_parser::lexer`.
    #[inline]
    pub fn is_latin1_identifier_u16(name: &[u16]) -> bool {
        bun_ast::lexer_tables::is_latin1_identifier_u16(name)
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
/// generic bool. Zig's `Output.prettyFmt(comptime fmt, comptime enable_colors)`
/// took a comptime bool; the Rust macro only matches `true`/`false` literals,
/// so monomorphized callers (`<const C: bool>`) branch here.
// PERF(port): was comptime bool dispatch — both arms are `&'static str`.
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
    // callers leak via `heap::alloc(Pin::into_inner_unchecked(..))` — the
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
        let p: *mut ConsoleObject = &raw mut *out;
        unsafe {
            (*p).error_writer_backing = error_writer
                .quiet_writer()
                .adapt_to_new_api(&mut (*p).stderr_buffer);
            (*p).writer_backing = writer
                .quiet_writer()
                .adapt_to_new_api(&mut (*p).stdout_buffer);
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
            (*p).error_writer_backing = error_writer
                .quiet_writer()
                .adapt_to_new_api(&mut (*p).stderr_buffer);
            (*p).writer_backing = writer
                .quiet_writer()
                .adapt_to_new_api(&mut (*p).stdout_buffer);
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
}

impl MessageLevel {
    /// Zig spec is `enum(u32) { ..., _ }` (non-exhaustive). Taking the
    /// exhaustive Rust enum directly across the C ABI would be instant UB if
    /// JSC ever passes an out-of-range discriminant, so the
    /// `Bun__ConsoleObject__messageWithTypeAndLevel` shim accepts a raw `u32`
    /// and routes through here. Unknown values fold to `Log` — no Zig codepath
    /// branches on the `_` case, so any clamp is spec-equivalent.
    #[inline]
    pub const fn from_raw(raw: u32) -> Self {
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
    /// See [`MessageLevel::from_raw`] — Zig spec is non-exhaustive
    /// (`enum(u32) { ..., _ }`); fold unknown discriminants to `Log` so the
    /// FFI boundary never constructs an invalid enum value.
    #[inline]
    pub const fn from_raw(raw: u32) -> Self {
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

/// `globalThis.bunVM().console` — `VirtualMachine.console` is typed
/// `*mut c_void` (erased so `virtual_machine.rs` need not name this module's
/// type). This is the single re-entry point that casts it back; every body
/// below goes through it instead of touching the field directly.
#[inline]
fn vm_console(global: &JSGlobalObject) -> *mut ConsoleObject {
    // SAFETY: `VirtualMachine.console` is initialized once at VM construction
    // (see `init` above — written into stable boxed storage) and lives for the
    // VM's lifetime; the C++ side never calls into `Bun__ConsoleObject__*`
    // before that. Returned as a raw pointer (not `&'static mut`) so callers
    // dereference at each use site without holding overlapping `&mut`
    // references — matches the Zig shape (`*ConsoleObject` field).
    global.bun_vm().as_mut().console.cast::<ConsoleObject>()
}

/// `&mut ConsoleObject` accessor for the set-once `VirtualMachine.console`
/// box. Consolidates the open-coded `&mut *vm_console(global)` deref at the
/// `Bun__ConsoleObject__*` FFI entry points (each is a top-level JS-thread
/// host call, so the `&mut` is exclusive for the duration). Callers that need
/// to interleave borrows across a deferred guard (`message_with_type_and_level_`)
/// keep using the raw [`vm_console`] pointer instead.
#[inline]
fn vm_console_mut(global: &JSGlobalObject) -> &mut ConsoleObject {
    // SAFETY: see [`vm_console`] — `VirtualMachine.console` is initialized once
    // at VM construction to a boxed `ConsoleObject` that lives for the VM's
    // lifetime; the C++ side never calls into `Bun__ConsoleObject__*` before
    // that. Single-JS-thread invariant ⇒ the returned `&mut` is exclusive.
    unsafe { &mut *vm_console(global) }
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
/// last exit). Replaces the Zig `defer { ... unlock() }` pair.
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

/// RAII flush of a borrowed `bun_io::Write` at scope exit when `enabled`
/// (Zig: `defer if (options.flush) writer.flush()`).
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
#[crate::host_call]
pub extern "C" fn message_with_type_and_level(
    ctype: *mut ConsoleObject,
    message_type: MessageType,
    level: MessageLevel,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) {
    if let Err(err) = message_with_type_and_level_(ctype, message_type, level, global, vals, len) {
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
    // Capture the raw pointer (Copy) by `move` so no borrow of the local is
    // held across the body; dereference only at scope-exit.
    let is_start_group = message_type == MessageType::StartGroup;
    let _indent_guard = scopeguard::guard(console, move |console| {
        // SAFETY: see `vm_console` — points at the live boxed
        // `ConsoleObject` for this VM; JS-thread-only.
        unsafe {
            (*console).default_indent = (*console)
                .default_indent
                .saturating_add(is_start_group as u16);
        }
    });

    if message_type == MessageType::StartGroup && len == 0 {
        // undefined is printed if passed explicitly.
        return Ok(());
    }

    if message_type == MessageType::EndGroup {
        // Safe accessor (set-once `VirtualMachine.console` box) — no other
        // borrow of the console is live yet; the deferred `_indent_guard`
        // captured only the raw pointer.
        let c = vm_console_mut(global);
        c.default_indent = c.default_indent.saturating_sub(1);
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
        // Safe accessor — no other borrow of the console is live in this
        // early-return arm (the deferred `_indent_guard` only holds the raw
        // pointer, not a reference).
        let ew = vm_console_mut(global).error_writer();
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
    // later reads (FormatOptions / TablePrinter) can use this cached copy
    // instead of re-dereferencing the raw `console` pointer.
    let default_indent = vm_console_mut(global).default_indent;

    // SAFETY: see [`vm_console`] — `console` points at the live boxed
    // `ConsoleObject` for this VM; JS-thread-only. Kept as a raw deref (not
    // `vm_console_mut`) so the resulting `writer` borrow does not pin a
    // long-lived `&mut ConsoleObject` across the re-derive in the empty-`Log`
    // arm below.
    let raw_writer: &mut bun_core::io::Writer = unsafe {
        if matches!(level, MessageLevel::Warning | MessageLevel::Error) {
            (*console).error_writer()
        } else {
            (*console).writer()
        }
    };
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

    // SAFETY: caller (JSC C++) guarantees `vals` points to `len` JSValues.
    let vals_slice = unsafe { bun_core::ffi::slice(vals, len) };

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
        // SAFETY: see [`vm_console`]. `writer` (above) is dead in this arm —
        // the only later uses are in the mutually-exclusive `Trace` block, and
        // `message_type == Log` here.
        let w = unsafe { (*console).writer() };
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
    level: MessageLevel,
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

impl Default for Column {
    fn default() -> Self {
        Self {
            name: BunString::empty(),
            width: 1,
        }
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
    /// Compute how much horizontal space a `JSValue` will take when printed.
    fn get_width_for_value(&mut self, value: JSValue) -> JsResult<u32> {
        let mut width: usize = 0;
        // PERF(port): Zig used a 512-byte discard buffer between the generic
        // writer adapter and the counter to amortize vtable calls; here we
        // write straight into the counter. Profile in Phase B.
        let mut counter = VisibleCharacterCounter { width: &mut width };
        let mut value_formatter = self.value_formatter.shallow_clone();

        let tag = formatter::Tag::get(value, self.global_object)?;
        value_formatter.quote_strings = !(matches!(
            tag.tag,
            TagPayload::String | TagPayload::StringPossiblyFormatted
        ));
        let _ = value_formatter.format::<false>(tag, &mut counter, value, self.global_object);
        // VisibleCharacterCounter write cannot fail.
        let _ = bun_io::Write::flush(&mut counter);

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
            RowKey::Str(value) => {
                u32::try_from(value.visible_width_exclude_ansi_colors(false)).expect("int cast")
            }
            RowKey::Num(value) => bun_core::fmt::digit_count(*value) as u32,
        };
        columns[0].width = columns[0].width.max(row_key_len);

        // special handling for Map: column with idx=1 is "Keys"
        if self.jstype.is_map() {
            let entry_key = row_value.get_index(self.global_object, 0)?;
            let entry_value = row_value.get_index(self.global_object, 1)?;
            columns[1].width = columns[1].width.max(self.get_width_for_value(entry_key)?);
            self.values_col_width = Some(
                self.values_col_width
                    .unwrap_or(0)
                    .max(self.get_width_for_value(entry_value)?),
            );
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
                    jsc::PropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                    },
                )?;

                while let Some(col_key) = cols_iter.next()? {
                    let value = cols_iter.value;

                    // find or create the column for the property
                    let column: &mut Column = 'brk: {
                        let col_str = BunString::init(col_key);

                        // PORT NOTE: reshaped for borrowck — split find/append.
                        if let Some(idx) =
                            columns[1..].iter().position(|col| col.name.eql(&col_str))
                        {
                            break 'brk &mut columns[1 + idx];
                        }

                        // Need to ref this string because JSPropertyIterator
                        // uses `toString` instead of `toStringRef` for property
                        // names.
                        col_str.ref_();

                        columns.push(Column {
                            name: col_str,
                            width: 1,
                        });
                        let last = columns.len() - 1;
                        break 'brk &mut columns[last];
                    };

                    column.width = column.width.max(self.get_width_for_value(value)?);
                }
            }
        } else if self.properties.is_undefined() {
            // not object -> the value will go to the special "Values" column
            self.values_col_width = Some(
                self.values_col_width
                    .unwrap_or(1)
                    .max(self.get_width_for_value(row_value)?),
            );
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
                RowKey::Num(value) => bun_core::fmt::digit_count(*value) as u32,
            };
            let needed = columns[0].width.saturating_sub(len);

            // Right-align the number column
            writer
                .splat_byte_all(b' ', (needed + PADDING) as usize)
                .ok();
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

                value_formatter.quote_strings = !(matches!(
                    tag.tag,
                    TagPayload::String | TagPayload::StringPossiblyFormatted
                ));

                // `defer` block: release pooled visit map after formatting.
                // PORT NOTE: Zig's `defer` body also nulls
                // `this.value_formatter.map_node`, but `shallow_clone()`
                // already guarantees the source's `map_node` is `None`, so
                // only the local clone needs draining. `Formatter::Drop` does
                // the same release, so a plain scope is sufficient.
                {
                    let result = value_formatter.format::<ENABLE_ANSI_COLORS>(
                        tag,
                        writer,
                        value,
                        self.global_object,
                    );
                    if let Some(mut node) = value_formatter.map_node.take() {
                        self.value_formatter.map_node = None;
                        let data = formatter::visited::node_data_mut(&mut node);
                        if data.capacity() > 512 {
                            data.deinit();
                        } else {
                            data.clear();
                        }
                        formatter::visited::Pool::release(node.as_ptr());
                    }
                    result?;
                }

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
        let mut _deref_names = scopeguard::guard(&mut columns, |cols| {
            for col in cols.iter_mut() {
                col.name.deref();
            }
        });
        // PORT NOTE: reshaped for borrowck — re-borrow through the guard.
        let columns: &mut Vec<Column> = &mut **_deref_names;

        // create the first column " " which is always present
        columns.push(Column {
            name: BunString::static_("\u{0020}"),
            width: 1,
        });
        // PERF(port): was assume_capacity

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

        // rows first pass - calculate the column widths
        {
            if self.is_iterable {
                struct Ctx<'c, 'a> {
                    this: &'c mut TablePrinter<'a>,
                    columns: &'c mut Vec<Column>,
                    idx: u32,
                    err: bool,
                }
                // Capture before constructing `ctx` (which mutably borrows `*self`).
                let tabular_data = self.tabular_data;
                let mut ctx = Ctx {
                    this: self,
                    columns,
                    idx: 0,
                    err: false,
                };
                extern "C" fn callback(
                    _: *mut jsc::VM,
                    _: &JSGlobalObject,
                    ctx: *mut c_void,
                    value: JSValue,
                ) {
                    // SAFETY: ctx points to the stack `Ctx` above.
                    let ctx = unsafe { bun_ptr::callback_ctx::<Ctx<'_, '_>>(ctx) };
                    if ctx
                        .this
                        .update_columns_for_row(ctx.columns, RowKey::Num(ctx.idx), value)
                        .is_err()
                    {
                        ctx.err = true;
                    }
                    ctx.idx += 1;
                }
                tabular_data.for_each_with_context(
                    global_object,
                    (&raw mut ctx).cast::<c_void>(),
                    callback,
                )?;
                if ctx.err {
                    return Err(jsc::JsError::Thrown);
                }
            } else {
                let tabular_obj = self.tabular_data.to_object(global_object)?;
                let mut rows_iter = jsc::JSPropertyIterator::init(
                    global_object,
                    tabular_obj,
                    jsc::PropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                    },
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

            writer.write_all("┌".as_bytes()).ok();
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    writer.write_all("┬".as_bytes()).ok();
                }
                Self::write_string_n_times(
                    writer,
                    "─".as_bytes(),
                    (col.width + PADDING * 2) as usize,
                )
                .ok();
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
                Self::write_string_n_times(
                    writer,
                    "─".as_bytes(),
                    (col.width + PADDING * 2) as usize,
                )
                .ok();
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
                // Capture before constructing `ctx` (which mutably borrows `*self`).
                let tabular_data = self.tabular_data;
                let mut ctx = Ctx {
                    this: self,
                    columns,
                    writer,
                    idx: 0,
                    err: false,
                };
                extern "C" fn callback<const C: bool>(
                    _: *mut jsc::VM,
                    _: &JSGlobalObject,
                    ctx: *mut c_void,
                    value: JSValue,
                ) {
                    // SAFETY: ctx points to the stack `Ctx` above.
                    let ctx = unsafe { bun_ptr::callback_ctx::<Ctx<'_, '_>>(ctx) };
                    if ctx
                        .this
                        .print_row::<C>(ctx.writer, ctx.columns, RowKey::Num(ctx.idx), value)
                        .is_err()
                    {
                        ctx.err = true;
                    }
                    ctx.idx += 1;
                }
                tabular_data.for_each_with_context(
                    global_object,
                    (&raw mut ctx).cast::<c_void>(),
                    callback::<ENABLE_ANSI_COLORS>,
                )?;
                if ctx.err {
                    return Err(jsc::JsError::Thrown);
                }
            } else {
                let Some(cell) = self.tabular_data.to_cell() else {
                    return Err(global_object.throw_type_error(format_args!(
                        "tabular_data must be an object or array"
                    )));
                };
                // `JSCell` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
                // centralised non-null deref proof (live JSC heap cell).
                let row_obj = jsc::JSCell::opaque_ref(cell).to_object(global_object);
                let mut rows_iter = jsc::JSPropertyIterator::init(
                    global_object,
                    row_obj,
                    jsc::PropertyIteratorOptions {
                        skip_empty_name: false,
                        include_value: true,
                    },
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

/// Adapter: erase a `&mut dyn bun_io::Write` behind the `bun_core::io::Writer`
/// vtable header so it can be handed to `VirtualMachine::print_stack_trace` /
/// `print_errorlike_object`, which take the concrete `io::Writer` type.
///
/// `bun_core::io::Writer` is the first `#[repr(C)]` field, so the vtable thunks
/// recover `&mut Self` from the `*mut io::Writer` they receive (same pattern as
/// `Output::QuietWriterAdapter::new_interface`).
#[repr(C)]
pub(crate) struct DynWriteAdapter<'a> {
    head: bun_core::io::Writer,
    inner: &'a mut dyn bun_io::Write,
}

impl<'a> DynWriteAdapter<'a> {
    pub(crate) fn new(inner: &'a mut dyn bun_io::Write) -> Self {
        Self {
            head: bun_core::io::Writer {
                write_all: Self::thunk_write_all,
                flush: Self::thunk_flush,
            },
            inner,
        }
    }

    /// Reborrow as the `io::Writer` head.
    #[inline]
    pub(crate) fn interface(&mut self) -> &mut bun_core::io::Writer {
        // SAFETY: `head` is the first `#[repr(C)]` field, so `&mut self.head`
        // and `&mut *self as *mut io::Writer` are the same address; the thunks
        // below cast back to `*mut Self`.
        &mut self.head
    }

    fn thunk_write_all(w: *mut bun_core::io::Writer, bytes: &[u8]) -> Result<(), bun_core::Error> {
        // SAFETY: only reachable via the `io::Writer` vtable installed in
        // `Self::new`, which always passes `&mut self.head` (first repr(C)
        // field) as `w`; safe-fn coerces to the unsafe-fn-ptr slot type.
        let this = unsafe { &mut *w.cast::<Self>() };
        this.inner.write_all(bytes)
    }

    fn thunk_flush(w: *mut bun_core::io::Writer) -> Result<(), bun_core::Error> {
        // SAFETY: only reachable via the `io::Writer` vtable installed in
        // `Self::new`, which always passes `&mut self.head` (first repr(C)
        // field) as `w`; safe-fn coerces to the unsafe-fn-ptr slot type.
        let this = unsafe { &mut *w.cast::<Self>() };
        this.inner.flush()
    }
}

pub fn write_trace(writer: &mut dyn bun_io::Write, global: &JSGlobalObject) {
    let mut holder = crate::zig_exception::Holder::init();
    // SAFETY: per-thread VM; `console.trace()` only runs on the JS thread.
    let vm = VirtualMachine::get().as_mut();

    let mut source_code_slice: Option<bun_core::ZigStringSlice> = None;

    let err = ZigString::init(b"trace output").to_error_instance(global);
    {
        let exception = holder.zig_exception();
        err.to_zig_exception(global, exception);
    }
    // PORT NOTE: reshaped for borrowck — Zig held `exception` and
    // `&holder.need_to_clear_parser_arena_on_deinit` simultaneously; in Rust
    // those are two `&mut` into `holder`. Capture the flag in a local and
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

    let mut adapter = DynWriteAdapter::new(writer);
    let _ = VirtualMachine::print_stack_trace(
        adapter.interface(),
        &holder.zig_exception().stack,
        Output::enable_ansi_colors_stderr(),
    );

    // Zig: `defer if (source_code_slice) |slice| slice.deinit();` —
    // `ZigStringSlice` frees on `Drop`.
    drop(source_code_slice);
    // Zig: `defer holder.deinit(vm);` — explicit (takes `vm`).
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
                ErrorDisplayLevel::Warn => writer.write_str(pfmt!("<r><yellow>", true))?,
                ErrorDisplayLevel::Full => writer.write_str(pfmt!("<r><red>", true))?,
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
    let vals = unsafe { bun_core::ffi::slice(vals, len) };

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
            // PORT NOTE: Zig `defer if (options.flush) writer.flush()`.
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

    // PORT NOTE: Zig `defer if (options.flush) writer.flush()`.
    // Reborrow through the guard so SB sees body writes as children of the
    // guard's borrow (see `FlushOnDrop` doc).
    let mut _flush = FlushOnDrop {
        writer,
        enabled: options.flush,
    };
    let writer: &mut dyn bun_io::Write = &mut *_flush.writer;

    let mut this_value: JSValue = vals[0];
    // PORT NOTE: see E0509 note above.
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

    /// RAII: write `prev` back through `place` on drop (Zig
    /// `defer this.field = prev;`). Holds a raw `*mut` so the body of the
    /// scope can freely take `&mut self` without aliasing the borrow.
    ///
    /// NOTE(aliasing): the `addr_of_mut!(self.field)` → body uses `&mut self`
    /// → guard derefs raw pointer pattern is sound under Tree Borrows but
    /// pops the raw pointer's tag under Stacked Borrows. Miri runs of this
    /// module require `-Zmiri-tree-borrows`. Applies to `Decrement` below and
    /// the `scopeguard::defer!` raw-pointer captures throughout `print_as`.
    pub(super) struct Restore<T: Copy> {
        place: *mut T,
        prev: T,
    }
    impl<T: Copy> Drop for Restore<T> {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: `place` was taken via `addr_of_mut!` on a field of a
            // value that outlives this guard; no other borrow is live at drop.
            unsafe { *self.place = self.prev };
        }
    }

    /// `saturating_sub(1)` for the integer field types `Decrement` is used on.
    pub(super) trait SaturatingDec: Copy {
        fn saturating_dec(self) -> Self;
    }
    impl SaturatingDec for u16 {
        #[inline]
        fn saturating_dec(self) -> Self {
            self.saturating_sub(1)
        }
    }
    impl SaturatingDec for u32 {
        #[inline]
        fn saturating_dec(self) -> Self {
            self.saturating_sub(1)
        }
    }

    /// RAII: `*place -|= 1` on drop (Zig `defer this.field -|= 1;`). Holds a
    /// raw `*mut` so the body can freely take `&mut self`.
    pub(super) struct Decrement<T: SaturatingDec> {
        place: *mut T,
    }
    impl<T: SaturatingDec> Drop for Decrement<T> {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: `place` was taken via `addr_of_mut!` on a field of a
            // value that outlives this guard; no other borrow is live at drop.
            unsafe { *self.place = (*self.place).saturating_dec() };
        }
    }

    /// RAII: `map.remove(value)` on drop iff `*armed` (Zig
    /// `defer { if (...) _ = this.map.remove(value); }` in `printAs`). Holds
    /// raw pointers so the body can freely take `&mut self`; smaller than the
    /// equivalent `scopeguard::defer!` closure under ASAN stack redzones.
    pub(super) struct VisitedRemove {
        map: *mut visited::Map,
        armed: *const bool,
        value: JSValue,
    }
    impl Drop for VisitedRemove {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: `map`/`armed` were taken via `addr_of!` on locals that
            // outlive this guard; no other borrow is live at drop.
            unsafe {
                if *self.armed {
                    let _ = (*self.map).remove(&self.value);
                }
            }
        }
    }

    /// Mirror Zig's `defer this.field = prev;` without holding a live borrow
    /// on `self` for the body of the scope. Zig `defer` reads at scope-exit
    /// time and never aliases, so we capture a raw `*mut` to the field and
    /// write through it on drop. This lets the body freely take `&mut self`.
    macro_rules! defer_restore {
        ($place:expr, $prev:expr) => {
            Restore {
                place: core::ptr::addr_of_mut!($place),
                prev: $prev,
            }
        };
    }

    /// Mirror Zig's `defer this.field -|= 1;` without holding a live borrow.
    macro_rules! defer_decrement {
        ($place:expr) => {
            Decrement {
                place: core::ptr::addr_of_mut!($place),
            }
        };
    }

    pub struct Formatter<'a> {
        pub global_this: &'a JSGlobalObject,

        /// Callers seat this to a stack slice and reset it to `EMPTY` before
        /// the backing storage goes away (mirrors the Zig
        /// `defer self.formatter.remaining_values = &.{}` pattern). A `&'a`
        /// slice cannot express that without forcing `'a` to outlive locals;
        /// `RawSlice` carries the outlives-holder invariant instead.
        pub remaining_values: bun_ptr::RawSlice<JSValue>,
        pub map: visited::Map,
        /// Pooled backing for `map`. `None` until the first cell that can have
        /// circular refs is formatted; `Drop` returns it to `visited::Pool`.
        /// Raw pointer (not `Box`) because `visited::Pool` owns the
        /// `heap::alloc`/`from_raw` lifecycle — mirrors Zig
        /// `?*Visited.Pool.Node`.
        pub map_node: Option<core::ptr::NonNull<visited::PoolNode>>,
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
                // Zig field default `.{}` (`cached_stack_end = 0` ⇒ check
                // always passes); callers that want a real bound overwrite
                // with `StackCheck::init()` explicitly.
                stack_check: StackCheck::default(),
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
        /// Callers always seat `remaining_values` to a slice that outlives the
        /// dereference site and reset it to `EMPTY` before the backing storage
        /// is released (RawSlice invariant).
        #[inline]
        pub fn remaining(&self) -> &[JSValue] {
            self.remaining_values.slice()
        }

        /// Drop the first queued `%`-format argument.
        #[inline]
        pub fn advance_remaining(&mut self) {
            let s = self.remaining_values;
            self.remaining_values = bun_ptr::RawSlice::new(&s.slice()[1..]);
        }
    }

    impl Drop for Formatter<'_> {
        fn drop(&mut self) {
            if let Some(mut node) = self.map_node.take() {
                // Move the working map back into the pooled node, shrink if it
                // ballooned, then return the node to the thread-local pool.
                // Mirrors `Formatter.deinit` (ConsoleObject.zig:1016-1024).
                let map = core::mem::take(&mut self.map);
                // `node_data_mut` is safe: `Map::INIT` is `Some`, so the
                // pooled slot already holds an (empty, post-`take`) `Map`;
                // assigning over it drops that empty value and moves `map` in.
                let data = visited::node_data_mut(&mut node);
                *data = map;
                if data.capacity() > 512 {
                    data.deinit();
                } else {
                    data.clear();
                }
                visited::Pool::release(node.as_ptr());
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
            Self {
                formatter: Cell::new(Some(formatter)),
                value,
            }
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
            formatter.remaining_values = bun_ptr::RawSlice::new(&one);

            let result = (|| {
                let tag =
                    Tag::get(self.value, formatter.global_this).map_err(|_| core::fmt::Error)?;
                // TODO(port): need a `&mut dyn bun_io::Write` over `f`.
                let mut sink = bun_io::FmtAdapter::new(f);
                let global = formatter.global_this;
                formatter
                    .format::<false>(tag, &mut sink, self.value, global)
                    .map_err(|_| core::fmt::Error)
            })();

            // Mirrors Zig `defer self.formatter.remaining_values = &.{}`.
            formatter.remaining_values = bun_ptr::RawSlice::EMPTY;
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
            // Zig: `ObjectPool(Map, Map.init, true, 16)` — fresh nodes start
            // with an empty map so `clearRetainingCapacity()` on first use is
            // well-defined.
            const INIT: Option<fn() -> Result<Self, bun_core::Error>> = Some(|| Ok(Map::default()));
        }

        // Thread-local free list, capped at 16 nodes — matches Zig
        // `threadsafe = true, max_count = 16`.
        bun_collections::object_pool!(pub Pool: Map, threadsafe, 16);
        pub type PoolNode = bun_collections::pool::Node<Map>;

        /// Safe `&mut Map` accessor for a pooled node. `Map::INIT` is `Some`,
        /// so every node returned by [`Pool::get_node`] carries an initialized
        /// `data` payload, and the caller exclusively owns the node until
        /// [`Pool::release`]. Centralises the `NonNull::as_mut()` +
        /// `assume_init_mut()` pair so the four call sites in this file (and
        /// the cause-chain guard in `VirtualMachine::print_error_instance`)
        /// don't each open-code two `unsafe` operations.
        #[inline]
        pub fn node_data_mut(node: &mut core::ptr::NonNull<PoolNode>) -> &mut Map {
            // SAFETY: `Map::INIT` is `Some`, so `data` is initialized for
            // every node from `Pool::get_node()`; the caller owns `node`
            // exclusively until `Pool::release`, so forming `&mut` is sound.
            unsafe { node.as_mut().data.assume_init_mut() }
        }
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
        /// Zig `Formatter.Tag.get` — `TagPayload` is the Rust spelling of the
        /// Zig union, so the constructor lives here as well as on the bare
        /// discriminant `Tag`. Callers in sibling modules use either name.
        #[inline]
        pub fn get(value: JSValue, global_this: &JSGlobalObject) -> JsResult<TagResult> {
            Tag::get(value, global_this)
        }
        /// Zig `Formatter.Tag.getAdvanced`.
        #[inline]
        pub fn get_advanced(
            value: JSValue,
            global_this: &JSGlobalObject,
            opts: TagOptions,
        ) -> JsResult<TagResult> {
            Tag::get_advanced(value, global_this, opts)
        }
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

        pub fn get_advanced(
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
                    // SAFETY: `value` is a cell with `js_type == GlobalProxy`,
                    // so `as_object_ref()` is a valid `JSObjectRef` for the
                    // C API call.
                    let target = JSValue::c(unsafe {
                        jsc::C::JSObjectGetProxyTarget(value.as_object_ref())
                    });
                    return Tag::get(target, global_this);
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
                    let mut react_element_legacy = ZigString::init(b"react.element");
                    // For React 19 - https://github.com/oven-sh/bun/issues/17223
                    let mut react_element_transitional =
                        ZigString::init(b"react.transitional.element");
                    let mut react_fragment = ZigString::init(b"react.fragment");

                    if typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, &mut react_element_legacy),
                        global_this,
                    )? || typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, &mut react_element_transitional),
                        global_this,
                    )? || typeof_symbol.is_same_value(
                        JSValue::symbol_for(global_this, &mut react_fragment),
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

    /// Mirrors Zig's `jsc.C.CellType` — same enum as `JSType` in this codebase.
    #[allow(dead_code)]
    type CellType = jsc::JSType;

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
                                // PORT NOTE: reshaped for borrowck — drop `writer` borrow before
                                // recursing into `print_as` which takes `&mut self`.
                                drop(writer);
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
                                // Zig: `defer str.deref()` — `OwnedString` releases the
                                // +1 WTF ref on every exit (incl. the `?` below).
                                let mut str = OwnedString::new(BunString::empty());
                                next_value.json_stringify_fast(global, &mut str)?;
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
                        .write_all(
                            &strings::immutable::latin1_to_codepoint_bytes_assume_not_ascii(
                                remain[i as usize],
                            ),
                        )
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
        pub fn write_indent(&self, writer: &mut dyn bun_io::Write) -> bun_io::Result<()> {
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

    pub struct MapIteratorCtx<
        'a,
        'b,
        const C: bool,
        const IS_ITERATOR: bool,
        const SINGLE_LINE: bool,
    > {
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
            let Some(ctx) = (unsafe { ctx.cast::<Self>().as_mut() }) else {
                return;
            };
            let this = ctx;
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
            let Some(this) = (unsafe { ctx.cast::<Self>().as_mut() }) else {
                return;
            };
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

        /// Prints `key:` (with quoting/symbol decoration) and the optional
        /// string-value colour prefix. Hoisted out of `for_each` so its
        /// `format_args!` temporaries are popped before the recursive
        /// `format()` call — keeps the per-level frame small enough for the
        /// 512-deep `Bun.inspect` test under debug/ASAN.
        #[inline(never)]
        fn write_property_key(
            writer: &mut WrappedWriter<'_>,
            key: &ZigString,
            is_symbol: bool,
            is_private_symbol: bool,
            quote_keys: bool,
            value_is_string_like: bool,
        ) {
            if !is_symbol {
                // TODO: make this one pass?
                if !key.is_16_bit()
                    && (!quote_keys && JSLexer::is_latin1_identifier_u8(key.slice()))
                {
                    writer.add_for_new_line(key.len + 1);
                    writer.print(format_args!(
                        concat!("{}", "{}", "{}"),
                        pfmt!("<r>", C),
                        key,
                        pfmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16_bit()
                    && (!quote_keys && JSLexer::is_latin1_identifier_u16(key.utf16_slice_aligned()))
                {
                    writer.add_for_new_line(key.len + 1);
                    writer.print(format_args!(
                        concat!("{}", "{}", "{}"),
                        pfmt!("<r>", C),
                        key,
                        pfmt!("<d>:<r> ", C),
                    ));
                } else if key.is_16_bit() {
                    let mut utf16_slice = key.utf16_slice_aligned();

                    writer.add_for_new_line(utf16_slice.len() + 2);

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
            key: *mut ZigString,
            value: JSValue,
            is_symbol: bool,
            is_private_symbol: bool,
        ) -> Option<TagResult> {
            // SAFETY: caller passes a valid `*ZigString`.
            let key = unsafe { &*key };
            if key.eql_comptime(b"constructor") {
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
            drop(writer);
            if writer_failed {
                ctx.formatter.failed = true;
            }
            Some(tag)
        }

        pub extern "C" fn for_each(
            global_this: &JSGlobalObject,
            ctx_ptr: *mut c_void,
            key: *mut ZigString,
            value: JSValue,
            is_symbol: bool,
            is_private_symbol: bool,
        ) {
            // SAFETY: ctx_ptr points to the stack-allocated `Self` passed by the caller via the C forEach callback.
            let Some(ctx) = (unsafe { ctx_ptr.cast::<Self>().as_mut() }) else {
                return;
            };

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
    ) -> JsResult<Option<ZigString>> {
        let mut name_str = ZigString::init(b"");
        value.get_class_name(global_this, &mut name_str)?;
        if !name_str.eql_comptime(b"Object") {
            return Ok(Some(name_str));
        } else if value.get_prototype(global_this).eql_value(JSValue::NULL) {
            return Ok(Some(ZigString::static_("[Object: null prototype]")));
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
                let mut node = core::ptr::NonNull::new(visited::Pool::get_node())
                    .expect("ObjectPool::get_node always returns a valid heap node");
                let data = visited::node_data_mut(&mut node);
                data.clear();
                self.map = core::mem::take(data);
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
        pub fn print_as<const ENABLE_ANSI_COLORS: bool>(
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

            // Zig: `defer { if (... && remove_before_recurse) _ = this.map.remove(value); }`.
            // The body mutates both `self` and `remove_before_recurse`, so
            // capture raw pointers and read the *current* `remove_before_recurse`
            // at scope-exit time, exactly like Zig's late-evaluated `defer`.
            let _visited = VisitedRemove {
                map: &raw mut self.map,
                armed: &raw const remove_before_recurse,
                value,
            };

            // Each arm is hoisted to its own `#[inline(never)]` helper so the
            // `print_as` frame stays small enough to recurse 512 levels under
            // debug/ASAN before the stack-safety check fires.
            match format {
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
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Per-tag helpers split out of print_as
    //
    // In Zig these are inline `switch` arms in `printAs`, where the comptime
    // `Format` parameter means each instantiation contains only one arm's
    // code and stack locals. Rust does not DCE dead `match` arms on a const
    // generic in debug builds, so keeping them inline would make every
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
            let str = value.to_slice(self.global_this)?;
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
            let str = OwnedString::new(BunString::from_js(value, self.global_this)?);
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
                    drop(writer);
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
                    drop(writer);
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
                let buf =
                    strings::immutable::allocate_latin1_into_utf8(str.latin1()).unwrap_or_default();
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
            let zstr = value.get_zig_string(self.global_this)?;
            let out_str = zstr.slice();
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
                let mut number_name = ZigString::EMPTY;
                value.get_class_name(self.global_this, &mut number_name)?;

                let mut number_value = ZigString::EMPTY;
                value.to_zig_string(&mut number_value, self.global_this)?;

                if number_name.slice() != b"Number" {
                    writer.add_for_new_line(
                        number_name.len + number_value.len + "[Number ():]".len(),
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

                writer.add_for_new_line(number_name.len + number_value.len + 4);
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
            // Strings are printed directly, otherwise we recurse. It is
            // possible to end up in an infinite loop.
            if result.is_string() {
                if writer_
                    .write_fmt(format_args!("{}", result.fmt_string(self.global_this)))
                    .is_err()
                {
                    self.failed = true;
                }
            } else {
                self.format::<C>(
                    Tag::get(result, self.global_this)?,
                    writer_,
                    result,
                    self.global_this,
                )?;
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

            if description.len > 0 {
                writer.add_for_new_line(description.len + "()".len());
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
            let map_restore_ptr: *mut visited::Map = &raw mut self.map;
            scopeguard::defer! {
                // SAFETY: `self.map` outlives this guard; no other borrow is
                // live at the drop point.
                unsafe {
                    if was_in_map {
                        let _ = (*map_restore_ptr).insert(value, ());
                    }
                }
            }

            let mut adapter = DynWriteAdapter::new(&mut *writer_);
            // SAFETY: per-thread VM.
            let vm = VirtualMachine::get().as_mut();
            vm.print_errorlike_object(value, None, None, self, adapter.interface(), C, false);
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
            let printable = OwnedString::new(value.get_name(self.global_this)?);
            writer.add_for_new_line(printable.length());

            // Only report `extends` when the parent is itself a class
            // (i.e. `class Foo extends Bar`). Built-in and DOM constructors
            // have `Function.prototype` as their prototype, which would
            // render as `[class X extends Function]` and is noise.
            let proto = value.get_prototype(self.global_this);
            let proto_is_class = !proto.is_empty_or_undefined_or_null()
                && proto.is_cell()
                && proto.is_class(self.global_this);
            let printable_proto = OwnedString::new(if proto_is_class {
                proto.get_name(self.global_this)?
            } else {
                BunString::empty()
            });
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
            let printable = OwnedString::new(value.get_name(self.global_this)?);

            let proto = value.get_prototype(self.global_this);
            // "Function" | "AsyncFunction" | "GeneratorFunction" | "AsyncGeneratorFunction"
            let func_name = OwnedString::new(proto.get_name(self.global_this)?);

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
            let promise: &JSPromise =
                JSPromise::opaque_ref(value.as_object_ref() as *const JSPromise);
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
                let mut bool_name = ZigString::EMPTY;
                value.get_class_name(self.global_this, &mut bool_name)?;
                let mut bool_value = ZigString::EMPTY;
                value.to_zig_string(&mut bool_value, self.global_this)?;

                if bool_name.slice() != b"Boolean" {
                    writer
                        .add_for_new_line(bool_value.len + bool_name.len + "[Boolean (): ]".len());
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
                writer.add_for_new_line(bool_value.len + "[Boolean: ]".len());
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
                match func.call(self.global_this, value, &[]) {
                    Err(_) => {
                        self.global_this.clear_exception();
                    }
                    Ok(result) => {
                        let prev_quote_keys = self.quote_keys;
                        self.quote_keys = true;
                        let _r = defer_restore!(self.quote_keys, prev_quote_keys);
                        let tag = Tag::get(result, self.global_this)?;
                        return self.format::<C>(tag, writer_, result, self.global_this);
                    }
                }
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
            let mut str = OwnedString::new(BunString::empty());

            value.json_stringify(self.global_this, self.indent, &mut str)?;
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
            {
                self.indent += 1;
                self.depth += 1;
                let _depth = defer_decrement!(self.depth);
                let _indent = defer_decrement!(self.indent);

                writer.add_for_new_line(2);

                let prev_quote_strings = self.quote_strings;
                self.quote_strings = true;
                let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
                let mut empty_start: Option<u32> = None;
                'first: {
                    let element = value.get_direct_index(self.global_this, 0);

                    let tag = Tag::get_advanced(element, self.global_this, tag_opts)?;

                    was_good_time = was_good_time
                        || !tag.tag.is_primitive()
                        || writer.good_time_for_a_new_line(self.indent);

                    if !self.single_line && (self.ordered_properties || was_good_time) {
                        writer.reset_line(self.indent);
                        writer.write_all(b"[");
                        writer.write_all(b"\n");
                        writer.write_indent(self.indent);
                        writer.add_for_new_line(1);
                    } else {
                        writer.write_all(b"[ ");
                        writer.add_for_new_line(2);
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
                        writer.print_comma::<C>();
                        writer.write_all(b"\n"); // we want the line break to be unconditional here
                        *writer.estimated_line_length = 0;
                        writer.write_indent(self.indent);
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
                            if !self.single_line
                                && (self.ordered_properties
                                    || writer.good_time_for_a_new_line(self.indent))
                            {
                                was_good_time = true;
                                writer.write_all(b"\n");
                                writer.write_indent(self.indent);
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
                        writer.print_comma::<C>();
                        if !self.single_line
                            && (self.ordered_properties
                                || writer.good_time_for_a_new_line(self.indent))
                        {
                            writer.write_all(b"\n");
                            was_good_time = true;
                            writer.write_indent(self.indent);
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
                    drop(writer);
                    // Hoist field reads before `formatter: self` reborrows the
                    // whole `*self` (struct-literal field order is not eval
                    // order in the borrow checker's eyes once `self` is moved).
                    let always_newline = !self.single_line
                        && (self.always_newline_scope || self.good_time_for_a_new_line());
                    let single_line = self.single_line;
                    let global_this = self.global_this;
                    let mut iter = PropertyIteratorCtx::<C> {
                        formatter: self,
                        writer: writer_,
                        always_newline,
                        single_line,
                        parent: value,
                        i: i as usize,
                    };
                    value.for_each_property_non_indexed(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
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
            // LAYERING: the Zig spec walks an `if (value.as(T))` chain over
            // `Response`/`Request`/`Blob`/`S3Client`/`Archive`/`BuildArtifact`/
            // `FetchHeaders`/`TimeoutObject`/`ImmediateObject`/`BuildMessage`/
            // `ResolveMessage`/Jest asymmetric matchers — all of which live in
            // `bun_runtime` (forward-dep). Dispatch through `RuntimeHooks` so
            // the high tier owns the downcasts. Hook returns `true` when it
            // formatted `value`; otherwise we fall through to the generic
            // object printer below.
            if let Some(hooks) = crate::virtual_machine::runtime_hooks() {
                // Zig: `threadlocal var name_buf: [512]u8`. The hook only ever
                // seeds a `ZigString` that `get_class_name` immediately
                // overwrites with JSC-owned bytes, so a shared zero buffer is
                // sufficient and keeps 512B off every recursive frame.
                static NAME_BUF: [u8; 512] = [0; 512];
                let handled =
                    (hooks.console_print_runtime_object)(self, writer_, value, &NAME_BUF, C)?;
                if handled {
                    return Ok(());
                }
            }

            // `DOMFormData` is a C++-backed WebCore type — no `JsClass` derive,
            // so use its dedicated `from_js` FFI downcast instead of `value.as_`.
            if crate::DOMFormData::from_js(value).is_some() {
                if let Some(to_json_function) = value.get(self.global_this, "toJSON")? {
                    let prev_quote_keys = self.quote_keys;
                    self.quote_keys = true;
                    let _r = defer_restore!(self.quote_keys, prev_quote_keys);

                    let result = to_json_function
                        .call(self.global_this, value, &[])
                        .unwrap_or_else(|err| self.global_this.take_exception(err));
                    return self.print_as::<C>(Tag::Object, writer_, result, jsc::JSType::Object);
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

            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            let map_name = if value.js_type() == jsc::JSType::WeakMap {
                "WeakMap"
            } else {
                "Map"
            };

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
                        formatter: self,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
                        MapIteratorCtx::<C, false, true>::for_each,
                    )?;
                    let count = iter.count;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    if count > 0 {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = MapIteratorCtx::<C, false, false> {
                        formatter: self,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
                        MapIteratorCtx::<C, false, false>::for_each,
                    )?;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                }
            }
            if !self.single_line {
                let _ = self.write_indent(writer_);
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
                        formatter: self,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
                        MapIteratorCtx::<C, true, true>::for_each,
                    )?;
                    let count = iter.count;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    // Spec divergence: Zig's `.SetIterator` arm writes NOTHING in
                    // single-line mode (`if (count > 0 and !single_line) writeAll("\n")`),
                    // only `.MapIterator` writes a trailing space.
                    if count > 0 && label == "MapIterator" {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = MapIteratorCtx::<C, true, false> {
                        formatter: self,
                        writer: writer_,
                        count: 0,
                    };
                    value.for_each(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
                        MapIteratorCtx::<C, true, false>::for_each,
                    )?;
                    let count = iter.count;
                    if iter.formatter.failed {
                        return Ok(());
                    }
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

            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            let set_name = if value.js_type() == jsc::JSType::WeakSet {
                "WeakSet"
            } else {
                "Set"
            };

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
                        formatter: self,
                        writer: writer_,
                        is_first: true,
                    };
                    value.for_each(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
                        SetIteratorCtx::<C, true>::for_each,
                    )?;
                    let is_first = iter.is_first;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                    if !is_first {
                        let _ = writer_.write_all(b" ");
                    }
                } else {
                    let mut iter = SetIteratorCtx::<C, false> {
                        formatter: self,
                        writer: writer_,
                        is_first: true,
                    };
                    value.for_each(
                        global_this,
                        (&raw mut iter).cast::<c_void>(),
                        SetIteratorCtx::<C, false>::for_each,
                    )?;
                    if iter.formatter.failed {
                        return Ok(());
                    }
                }
            }
            if !self.single_line {
                let _ = self.write_indent(writer_);
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
                        pf!("<r>"),
                        pf!("<green>"),
                        bstr::BStr::new(event_type.label()),
                        pf!("<r>"),
                        pf!("<d>"),
                        pf!("<r>")
                    );
                } else {
                    let _ = write!(
                        writer_,
                        "{}type: {}\"{}\"{}{},{}\n",
                        pf!("<r>"),
                        pf!("<green>"),
                        bstr::BStr::new(event_type.label()),
                        pf!("<r>"),
                        pf!("<d>"),
                        pf!("<r>")
                    );
                }

                if let Some(message_value) =
                    value.fast_get(self.global_this, jsc::BuiltinName::Message)?
                {
                    if message_value.is_string() {
                        if !self.single_line {
                            self.write_indent(writer_).expect("unreachable");
                        }
                        let _ = write!(
                            writer_,
                            "{}message{}:{} ",
                            pf!("<r><blue>"),
                            pf!("<d>"),
                            pf!("<r>")
                        );
                        let tag =
                            Tag::get_advanced(message_value, self.global_this, self.tag_opts())?;
                        self.format::<C>(tag, writer_, message_value, self.global_this)?;
                        if self.failed {
                            return Ok(());
                        }
                        self.print_comma::<C>(writer_).expect("unreachable");
                        if !self.single_line {
                            let _ = writer_.write_all(b"\n");
                        }
                    }
                }

                match event_type {
                    EventType::MessageEvent => {
                        if !self.single_line {
                            self.write_indent(writer_).expect("unreachable");
                        }
                        let _ = write!(
                            writer_,
                            "{}data{}:{} ",
                            pf!("<r><blue>"),
                            pf!("<d>"),
                            pf!("<r>")
                        );
                        let data: JSValue = value
                            .fast_get(self.global_this, jsc::BuiltinName::Data)?
                            .unwrap_or(JSValue::UNDEFINED);
                        let tag = Tag::get_advanced(data, self.global_this, self.tag_opts())?;
                        self.format::<C>(tag, writer_, data, self.global_this)?;
                        if self.failed {
                            return Ok(());
                        }
                        self.print_comma::<C>(writer_).expect("unreachable");
                        if !self.single_line {
                            let _ = writer_.write_all(b"\n");
                        }
                    }
                    EventType::ErrorEvent => {
                        if let Some(error_value) =
                            value.fast_get(self.global_this, jsc::BuiltinName::Error)?
                        {
                            if !self.single_line {
                                self.write_indent(writer_).expect("unreachable");
                            }
                            let _ = write!(
                                writer_,
                                "{}error{}:{} ",
                                pf!("<r><blue>"),
                                pf!("<d>"),
                                pf!("<r>")
                            );
                            let tag =
                                Tag::get_advanced(error_value, self.global_this, self.tag_opts())?;
                            self.format::<C>(tag, writer_, error_value, self.global_this)?;
                            if self.failed {
                                return Ok(());
                            }
                            self.print_comma::<C>(writer_).expect("unreachable");
                            if !self.single_line {
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

        // TODO(port): JSX printing is large (≈230 LOC) and entirely
        // self-contained string formatting over `value.get("type"/"key"/"props"
        // /"children")`. The logic is reproduced here at the same control-flow
        // shape; Phase B must verify against existing JSX snapshot tests
        // (`test/js/bun/util/inspect.test.js`) before trusting the borrow-reseat
        // points.
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

            // PORT NOTE: Zig initialized `needs_space = false` / `tag_name_slice = .empty`,
            // but both arms of the `type` if/else below assign them, so deferred init
            // avoids the dead-store warning while keeping semantics identical.
            let mut needs_space: bool;
            let mut tag_name_str = ZigString::init(b"");

            // PORT NOTE: Zig spelled this `ZigString.Slice` with an explicit
            // `defer if (tag_name_slice.isAllocated()) tag_name_slice.deinit()`.
            // The Rust `ZigStringSlice` enum frees on `Drop`, so the scopeguard
            // is unnecessary.
            let tag_name_slice: strings::ZigStringSlice;
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

                    if writer.failed {
                        self.failed = true;
                    }
                    drop(writer);
                    self.format::<C>(
                        Tag::get_advanced(key_value, self.global_this, self.tag_opts())?,
                        writer_,
                        key_value,
                        self.global_this,
                    )?;
                    writer = WrappedWriter {
                        ctx: writer_,
                        failed: false,
                        estimated_line_length: &mut self.estimated_line_length,
                    };

                    needs_space = true;
                }
            }

            if let Some(props) = value.get(self.global_this, "props")? {
                let prev_quote_strings = self.quote_strings;
                let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
                self.quote_strings = true;

                let Some(props_obj) = props.get_object() else {
                    writer.write_all(b" />");
                    if writer.failed {
                        self.failed = true;
                    }
                    return Ok(());
                };
                let mut props_iter = jsc::JSPropertyIterator::init(
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
                        let _ind = defer_decrement!(self.indent);
                        let count_without_children =
                            props_iter.len - usize::from(children_prop.is_some());

                        while let Some(prop) = props_iter.next()? {
                            let props_i = props_iter.i as usize;
                            if prop.eql_comptime("children") {
                                continue;
                            }

                            let property_value = props_iter.value;
                            let tag =
                                Tag::get_advanced(property_value, self.global_this, tag_opts)?;

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

                            if tag.cell.is_string_like() && C {
                                writer.write_all(pfmt!("<r><green>", true).as_bytes());
                            }

                            if writer.failed {
                                self.failed = true;
                            }
                            drop(writer);
                            self.format::<C>(tag, writer_, property_value, self.global_this)?;
                            writer = WrappedWriter {
                                ctx: writer_,
                                failed: false,
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

                        let print_children =
                            matches!(tag.tag.tag(), Tag::String | Tag::JSX | Tag::Array);

                        if print_children && !self.single_line {
                            'print_children: {
                                match tag.tag.tag() {
                                    Tag::String => {
                                        let children_string =
                                            children.get_zig_string(self.global_this)?;
                                        if children_string.len == 0 {
                                            break 'print_children;
                                        }
                                        if C {
                                            writer.write_all(pfmt!("<r>", true).as_bytes());
                                        }
                                        writer.write_all(b">");
                                        if children_string.len < 128 {
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
                                            let _ind = defer_decrement!(self.indent);
                                            if writer.failed {
                                                self.failed = true;
                                            }
                                            drop(writer);
                                            self.format::<C>(
                                                Tag::get(children, self.global_this)?,
                                                writer_,
                                                children,
                                                self.global_this,
                                            )?;
                                            writer = WrappedWriter {
                                                ctx: writer_,
                                                failed: false,
                                                estimated_line_length: &mut self
                                                    .estimated_line_length,
                                            };
                                        }
                                        writer.write_all(b"\n");
                                        write_indent_n(self.indent, writer.ctx)
                                            .expect("unreachable");
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
                                            let _prev_quote_strings = self.quote_strings;
                                            self.quote_strings = false;
                                            let _qs2 = defer_restore!(
                                                self.quote_strings,
                                                _prev_quote_strings
                                            );
                                            let _ind = defer_decrement!(self.indent);

                                            let mut j: usize = 0;
                                            while (j as u64) < length {
                                                let child = children.get_index(
                                                    self.global_this,
                                                    u32::try_from(j).expect("int cast"),
                                                )?;
                                                if writer.failed {
                                                    self.failed = true;
                                                }
                                                drop(writer);
                                                self.format::<C>(
                                                    Tag::get_advanced(
                                                        child,
                                                        self.global_this,
                                                        self.tag_opts(),
                                                    )?,
                                                    writer_,
                                                    child,
                                                    self.global_this,
                                                )?;
                                                writer = WrappedWriter {
                                                    ctx: writer_,
                                                    failed: false,
                                                    estimated_line_length: &mut self
                                                        .estimated_line_length,
                                                };
                                                if (j as u64) + 1 < length {
                                                    writer.write_all(b"\n");
                                                    write_indent_n(self.indent, writer.ctx)
                                                        .expect("unreachable");
                                                }
                                                j += 1;
                                            }
                                        }
                                        writer.write_all(b"\n");
                                        write_indent_n(self.indent, writer.ctx)
                                            .expect("unreachable");
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

                            if writer.failed {
                                self.failed = true;
                            }
                            return Ok(());
                        }
                    }
                }
            }

            writer.write_all(b" />");
            if writer.failed {
                self.failed = true;
            }
            Ok(())
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
            // Hoist all `self.*` reads before constructing the iterator ctx —
            // `formatter: self` is a `&mut Self` reborrow, so once it's moved
            // into the struct literal we can no longer touch `self` until
            // `iter` is dropped (or via `iter.formatter`).
            let single_line = self.single_line;
            let always_newline =
                !single_line && (self.always_newline_scope || self.good_time_for_a_new_line());
            if self.depth > self.max_depth {
                return self.print_object_depth_exceeded::<C>(writer_, value);
            }
            let ordered_properties = self.ordered_properties;
            let global_this = self.global_this;
            let mut iter = PropertyIteratorCtx::<C> {
                formatter: self,
                writer: writer_,
                always_newline,
                single_line,
                parent: value,
                i: 0,
            };

            if ordered_properties {
                value.for_each_property_ordered(
                    global_this,
                    (&raw mut iter).cast::<c_void>(),
                    PropertyIteratorCtx::<C>::for_each,
                )?;
            } else {
                value.for_each_property(
                    global_this,
                    (&raw mut iter).cast::<c_void>(),
                    PropertyIteratorCtx::<C>::for_each,
                )?;
            }

            // Extract what we need from `iter` so its `&mut self` / `&mut writer_`
            // reborrows end here (NLL) and the tail can use `self`/`writer_` again.
            let iter_i = iter.i;
            let iter_always_newline = iter.always_newline;

            if self.failed {
                return Ok(());
            }

            self.print_object_tail::<C>(writer_, value, js_type, iter_i, iter_always_newline)
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
                && bun_core::immutable::is_valid_utf8(slice)
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
                // TODO(port): Rust has no native f16; use `half::f16` in Phase B.
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

        // PORT NOTE: associated fn (no `&mut self`) so callers can pass a
        // `WrappedWriter` that already borrows `&mut self.estimated_line_length`
        // without tripping E0499. The only `self` use was `print_comma`, which
        // `WrappedWriter` mirrors.
        fn write_typed_array<N: TypedArrayElement, const C: bool>(
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
                writer.print_comma::<C>();
                if writer.failed {
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

        #[inline(always)]
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

            if let TagPayload::CustomFormattedObject(obj) = result.tag {
                self.custom_formatted_object = obj;
            }
            self.print_as::<ENABLE_ANSI_COLORS>(result.tag.tag(), writer, value, result.cell)
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
        fn display(self) -> Self::Display {
            bun_core::fmt::double(f64::from(self))
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
    let this = vm_console_mut(global_this);
    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { bun_core::ffi::slice(ptr, len) };
    let hash = bun_wyhash::hash(slice);
    // we don't want to store these strings, it will take too much memory
    let counter = this.counts.get_or_put(hash).expect("unreachable");
    let current: u32 = if counter.found_existing {
        *counter.value_ptr
    } else {
        0
    } + 1;
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
    let this = vm_console_mut(global_this);
    // SAFETY: caller passes a valid (ptr, len) pair.
    let slice = unsafe { bun_core::ffi::slice(ptr, len) };
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
    let id = bun_wyhash::hash(unsafe { bun_core::ffi::slice(chars, len) });
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
    let slice = unsafe { bun_core::ffi::slice(chars, len) };
    let id = bun_wyhash::hash(slice);
    // Zig `fetchPut(id, null)` — replace with `None`, returning the previous.
    let Some(prev) = PENDING_TIME_LOGS
        .with_borrow_mut(|m| m.get_mut(&id).map(|slot| core::mem::replace(slot, None)))
    else {
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
    let slice = unsafe { bun_core::ffi::slice(chars, len) };
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
    fmt.max_depth = bun_options_types::context::try_get()
        .and_then(|ctx| ctx.runtime_options.console_depth)
        .unwrap_or(DEFAULT_CONSOLE_LOG_DEPTH);
    fmt.stack_check = StackCheck::init();
    fmt.can_throw_stack_overflow = true;
    let console = vm_console_mut(global);
    let mut writer = console.error_writer();
    // SAFETY: caller passes a valid (args, args_len) pair.
    for &arg in unsafe { bun_core::ffi::slice(args, args_len) } {
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

/// Stamp out the empty `Bun__ConsoleObject__*` C-ABI hooks that JSC's
/// `ConsoleClient` vtable requires but Bun leaves unimplemented
/// (zig:ConsoleObject.zig:3728-3793 hand-writes six identical
/// `callconv(jsc.conv) void {}` stubs and `@export`s each). Two arms cover
/// the two trailing-arg shapes the C++ side declares in
/// `bindings/headers.h:686-694`: `(…, *const u8, usize)` for the title-string
/// hooks and `(…, *mut ScriptArguments)` for the inspector-args hooks.
///
/// Ident concat via `${concat()}` is unstable (`macro_metavar_expr_concat`)
/// and `paste` is not a `bun_jsc` dep, so the full `Bun__ConsoleObject__<name>`
/// export symbol is passed verbatim — same pattern as `export_callbacks!` in
/// `runtime/api/BunObject.rs`.
macro_rules! console_noop_hooks {
    (str: $($name:ident),+ $(,)?) => {$(
        #[unsafe(no_mangle)]
        #[crate::host_call]
        pub extern "C" fn $name(
            _console: *mut ConsoleObject,
            _global: &JSGlobalObject,
            _chars: *const u8,
            _len: usize,
        ) {
        }
    )+};
    (args: $($name:ident),+ $(,)?) => {$(
        #[unsafe(no_mangle)]
        #[crate::host_call]
        pub extern "C" fn $name(
            _console: *mut ConsoleObject,
            _global: &JSGlobalObject,
            _args: *mut ScriptArguments,
        ) {
        }
    )+};
}

console_noop_hooks!(str: Bun__ConsoleObject__profile, Bun__ConsoleObject__profileEnd);

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__takeHeapSnapshot(
    _console: *mut ConsoleObject,
    global_this: &JSGlobalObject,
    _chars: *const u8,
    _len: usize,
) {
    // TODO: this does an extra JSONStringify and we don't need it to!
    let snapshot: [JSValue; 1] = [global_this.generate_heap_snapshot()];
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

console_noop_hooks!(
    args:
    Bun__ConsoleObject__timeStamp,
    Bun__ConsoleObject__record,
    Bun__ConsoleObject__recordEnd,
    Bun__ConsoleObject__screenshot,
);

#[unsafe(no_mangle)]
#[crate::host_call]
pub extern "C" fn Bun__ConsoleObject__messageWithTypeAndLevel(
    ctype: *mut ConsoleObject,
    // Zig spec types both as non-exhaustive `enum(u32) { ..., _ }`. Taking the
    // exhaustive Rust enums by value at the C ABI would be UB on an
    // out-of-range discriminant, so accept the raw `u32` (matching the C++
    // header in `bindings/headers.h`) and clamp via `from_raw`.
    message_type: u32,
    level: u32,
    global: &JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) {
    // SAFETY: forwarding the same FFI args to the inner host shim.
    unsafe {
        message_with_type_and_level(
            ctype,
            MessageType::from_raw(message_type),
            MessageLevel::from_raw(level),
            global,
            vals,
            len,
        )
    };
}

// ported from: src/jsc/ConsoleObject.zig
