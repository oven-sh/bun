use core::fmt::{self, Write as _};
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_jsc::JsResult;

use crate::bun_test::{DescribeScope, Execution, ExecutionEntry, TestScheduleEntry};

pub fn dump_sub(current: &TestScheduleEntry) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    match current {
        TestScheduleEntry::Describe(describe) => dump_describe(describe)?,
        TestScheduleEntry::TestCallback(test_callback) => dump_test(test_callback, b"test")?,
    }
    Ok(())
}

pub fn dump_describe(describe: &DescribeScope) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    // TODO(port): std.zig.fmtString escaping — using BStr Debug-ish display for now
    group::begin_msg(format_args!(
        "describe \"{}\" (concurrent={}, mode={}, only={}, has_callback={})",
        bstr::BStr::new(describe.base.name.as_deref().unwrap_or(b"(unnamed)")),
        describe.base.concurrent,
        <&'static str>::from(describe.base.mode),
        <&'static str>::from(describe.base.only),
        describe.base.has_callback,
    ));
    let _guard = scopeguard::guard((), |_| group::end());

    for entry in describe.before_all.as_slice() {
        dump_test(entry, b"beforeAll")?;
    }
    for entry in describe.before_each.as_slice() {
        dump_test(entry, b"beforeEach")?;
    }
    for entry in describe.entries.as_slice() {
        dump_sub(entry)?;
    }
    for entry in describe.after_each.as_slice() {
        dump_test(entry, b"afterEach")?;
    }
    for entry in describe.after_all.as_slice() {
        dump_test(entry, b"afterAll")?;
    }
    Ok(())
}

pub fn dump_test(current: &ExecutionEntry, label: &[u8]) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    group::begin_msg(format_args!(
        "{} \"{}\" (concurrent={}, only={})",
        bstr::BStr::new(label),
        bstr::BStr::new(current.base.name.as_deref().unwrap_or(b"(unnamed)")),
        current.base.concurrent,
        current.base.only,
    ));
    let _guard = scopeguard::guard((), |_| group::end());
    Ok(())
}

pub fn dump_order(this: &Execution) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    group::begin_msg(format_args!("dumpOrder"));
    let _guard = scopeguard::guard((), |_| group::end());

    for (group_index, group_value) in this.groups.iter().enumerate() {
        group::begin_msg(format_args!(
            "{} ConcurrentGroup ({}-{})",
            group_index, group_value.sequence_start, group_value.sequence_end,
        ));
        let _guard = scopeguard::guard((), |_| group::end());

        for (sequence_index, sequence) in group_value.sequences(this).iter().enumerate() {
            group::begin_msg(format_args!(
                "{} Sequence ({}x)",
                sequence_index, sequence.remaining_repeat_count,
            ));
            let _guard = scopeguard::guard((), |_| group::end());

            let mut current_entry = sequence.first_entry;
            while let Some(entry) = current_entry {
                // TODO(port): lifetime — `entry` is a linked-list node ptr (?*ExecutionEntry in Zig)
                group::log(format_args!(
                    "ExecutionEntry \"{}\" (concurrent={}, mode={}, only={}, has_callback={})",
                    bstr::BStr::new(entry.base.name.as_deref().unwrap_or(b"(unnamed)")),
                    entry.base.concurrent,
                    <&'static str>::from(entry.base.mode),
                    <&'static str>::from(entry.base.only),
                    entry.base.has_callback,
                ));
                current_entry = entry.next;
            }
        }
    }
    Ok(())
}

pub mod group {
    use super::*;

    fn print_indent(writer: &mut impl fmt::Write) {
        let _ = write!(writer, "\x1b[90m");
        for _ in 0..INDENT.load(Ordering::Relaxed) {
            let _ = write!(writer, "│ ");
        }
        let _ = write!(writer, "\x1b[m");
    }

    // PORT NOTE: Zig used plain mutable globals; using atomics for Rust safety (debug-only path).
    static INDENT: AtomicUsize = AtomicUsize::new(0);
    static LAST_WAS_START: AtomicBool = AtomicBool::new(false);

    fn get_log_enabled_runtime() -> bool {
        bun_core::env_var::WANTS_LOUD.get()
    }

    #[inline(always)]
    fn get_log_enabled_static_false() -> bool {
        false
    }

    #[inline]
    pub fn get_log_enabled() -> bool {
        // bun.Environment.enable_logs gates the runtime check
        #[cfg(feature = "debug_logs")]
        {
            get_log_enabled_runtime()
        }
        #[cfg(not(feature = "debug_logs"))]
        {
            get_log_enabled_static_false()
        }
    }

    // TODO(port): std.builtin.SourceLocation — consider a macro wrapper using file!()/line!()/column!()
    pub fn begin(file: &str, line: u32, column: u32, fn_name: &str) {
        begin_msg(format_args!(
            "\x1b[36m{}\x1b[37m:\x1b[93m{}\x1b[37m:\x1b[33m{}\x1b[37m: \x1b[35m{}\x1b[m",
            file, line, column, fn_name,
        ));
    }

    pub fn begin_msg(args: fmt::Arguments<'_>) {
        if !get_log_enabled() {
            return;
        }

        // TODO(port): Zig used std.fs.File.stdout().writerStreaming with a 64-byte buffer;
        // route through bun_core::Output stdout writer in Phase B.
        let mut buf = String::new();
        print_indent(&mut buf);
        let _ = write!(buf, "\x1b[32m++ \x1b[0m");
        let _ = write!(buf, "{}\n", args);
        bun_core::Output::write_stdout(buf.as_bytes());

        INDENT.fetch_add(1, Ordering::Relaxed);
        LAST_WAS_START.store(true, Ordering::Relaxed);
    }

    pub fn end() {
        if !get_log_enabled() {
            return;
        }
        INDENT.fetch_sub(1, Ordering::Relaxed);
        let last_was_start = LAST_WAS_START.load(Ordering::Relaxed);
        // defer last_was_start = false;
        let _guard = scopeguard::guard((), |_| LAST_WAS_START.store(false, Ordering::Relaxed));
        if last_was_start {
            return; // std.fs.File.stdout().writer().print("\x1b[A", .{}) catch {};
        }

        let mut buf = String::new();
        print_indent(&mut buf);
        let _ = write!(
            buf,
            "\x1b[32m{}\x1b[m\n",
            if last_was_start { "+-" } else { "--" },
        );
        bun_core::Output::write_stdout(buf.as_bytes());
    }

    pub fn log(args: fmt::Arguments<'_>) {
        if !get_log_enabled() {
            return;
        }
        let mut buf = String::new();
        print_indent(&mut buf);
        let _ = write!(buf, "{}\n", args);
        bun_core::Output::write_stdout(buf.as_bytes());
        LAST_WAS_START.store(false, Ordering::Relaxed);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/debug.zig (108 lines)
//   confidence: medium
//   todos:      3
//   notes:      stdout writer API + std.zig.fmtString escaping + SourceLocation need Phase B wiring; mutable globals → atomics
// ──────────────────────────────────────────────────────────────────────────
