use core::fmt;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::io::Write as _;

use bun_jsc::JsResult;

use crate::test_runner::bun_test::{DescribeScope, ExecutionEntry, TestScheduleEntry};
use crate::test_runner::execution::Execution;

pub(crate) fn dump_sub(current: &TestScheduleEntry) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    match current {
        TestScheduleEntry::Describe(describe) => dump_describe(describe)?,
        TestScheduleEntry::TestCallback(test_callback) => dump_test(test_callback, b"test")?,
    }
    Ok(())
}

pub(crate) fn dump_describe(describe: &DescribeScope) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    // `BStr`'s `Debug` impl quotes and escapes the name.
    let _guard = group::begin_msg(format_args!(
        "describe {:?} (concurrent={}, mode={}, only={}, has_callback={})",
        bstr::BStr::new(describe.base.name.as_deref().unwrap_or(b"(unnamed)")),
        describe.base.concurrent,
        describe.base.mode.tag_name(),
        describe.base.only.tag_name(),
        describe.base.has_callback,
    ));

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

pub(crate) fn dump_test(current: &ExecutionEntry, label: &[u8]) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    let _guard = group::begin_msg(format_args!(
        "{} {:?} (concurrent={}, only={})",
        bstr::BStr::new(label),
        bstr::BStr::new(current.base.name.as_deref().unwrap_or(b"(unnamed)")),
        current.base.concurrent,
        current.base.only.tag_name(),
    ));
    Ok(())
}

pub(crate) fn dump_order(this: &Execution) -> JsResult<()> {
    if !group::get_log_enabled() {
        return Ok(());
    }
    let _guard = group::begin_msg(format_args!("dumpOrder"));

    for (group_index, group_value) in this.groups.iter().enumerate() {
        let _guard = group::begin_msg(format_args!(
            "{} ConcurrentGroup ({}-{})",
            group_index, group_value.sequence_start, group_value.sequence_end,
        ));

        for (sequence_index, sequence) in group_value.sequences_const(this).iter().enumerate() {
            let _guard = group::begin_msg(format_args!(
                "{} Sequence ({}x)",
                sequence_index, sequence.remaining_repeat_count,
            ));

            let mut current_entry: Option<NonNull<ExecutionEntry>> = sequence.first_entry;
            while let Some(entry_ptr) = current_entry {
                // SAFETY: linked-list nodes are owned by the Execution and remain valid for the
                // duration of this read-only dump.
                let entry = unsafe { entry_ptr.as_ref() };
                group::log(format_args!(
                    "ExecutionEntry \"{}\" (concurrent={}, mode={}, only={}, has_callback={})",
                    bstr::BStr::new(entry.base.name.as_deref().unwrap_or(b"(unnamed)")),
                    entry.base.concurrent,
                    entry.base.mode.tag_name(),
                    entry.base.only.tag_name(),
                    entry.base.has_callback,
                ));
                current_entry = entry.next.and_then(NonNull::new);
            }
        }
    }
    Ok(())
}

pub mod group {
    use super::*;

    fn print_indent(writer: &mut impl std::io::Write) {
        let _ = write!(writer, "\x1b[90m");
        for _ in 0..INDENT.load(Ordering::Relaxed) {
            let _ = write!(writer, "│ ");
        }
        let _ = write!(writer, "\x1b[m");
    }

    // Atomics for safety (debug-only path).
    static INDENT: AtomicUsize = AtomicUsize::new(0);
    static LAST_WAS_START: AtomicBool = AtomicBool::new(false);

    fn get_log_enabled_runtime() -> bool {
        bun_core::env_var::WANTS_LOUD.get().unwrap_or(false)
    }

    #[inline(always)]
    fn get_log_enabled_static_false() -> bool {
        false
    }

    #[inline]
    pub(crate) fn get_log_enabled() -> bool {
        // bun.Environment.enable_logs gates the runtime check
        if bun_core::Environment::ENABLE_LOGS {
            get_log_enabled_runtime()
        } else {
            get_log_enabled_static_false()
        }
    }

    /// RAII guard returned by [`begin`] / [`begin_msg`]; calls [`end`] on drop.
    #[must_use = "binding this guard keeps the log group open until end of scope"]
    pub(crate) struct GroupGuard(());

    impl Drop for GroupGuard {
        fn drop(&mut self) {
            end();
        }
    }

    /// Uses `#[track_caller]` so the source
    /// location is taken from the *call site* (file/line/column).
    #[track_caller]
    pub(crate) fn begin() -> GroupGuard {
        let loc = core::panic::Location::caller();
        begin_msg(format_args!(
            "\x1b[36m{}\x1b[37m:\x1b[93m{}\x1b[37m:\x1b[33m{}\x1b[37m: \x1b[35m{}\x1b[m",
            loc.file(),
            loc.line(),
            loc.column(),
            "", // fn_name not available in stable Rust
        ))
    }

    pub(crate) fn begin_msg(args: fmt::Arguments<'_>) -> GroupGuard {
        if get_log_enabled() {
            let mut buf: Vec<u8> = Vec::new();
            print_indent(&mut buf);
            let _ = write!(&mut buf, "\x1b[32m++ \x1b[0m");
            let _ = writeln!(&mut buf, "{}", args);
            let _ = bun_core::Output::writer().write_all(buf.as_slice());
            bun_core::Output::flush();

            INDENT.fetch_add(1, Ordering::Relaxed);
            LAST_WAS_START.store(true, Ordering::Relaxed);
        }
        // Guard returned unconditionally; `end()` is itself gated on
        // `get_log_enabled()` so the disabled path stays a symmetric no-op.
        GroupGuard(())
    }

    pub fn end() {
        if !get_log_enabled() {
            return;
        }
        INDENT.fetch_sub(1, Ordering::Relaxed);
        // Read-then-clear, so a single swap suffices.
        let last_was_start = LAST_WAS_START.swap(false, Ordering::Relaxed);
        if last_was_start {
            return;
        }

        let mut buf: Vec<u8> = Vec::new();
        print_indent(&mut buf);
        let _ = writeln!(
            &mut buf,
            "\x1b[32m{}\x1b[m",
            if last_was_start { "+-" } else { "--" },
        );
        let _ = bun_core::Output::writer().write_all(buf.as_slice());
        bun_core::Output::flush();
    }

    /// Accepts anything `Display` so callers can pass either `&str` literals or
    /// `format_args!(...)`.
    pub(crate) fn log(args: impl fmt::Display) {
        if !get_log_enabled() {
            return;
        }
        let mut buf: Vec<u8> = Vec::new();
        print_indent(&mut buf);
        let _ = writeln!(&mut buf, "{}", args);
        let _ = bun_core::Output::writer().write_all(buf.as_slice());
        bun_core::Output::flush();
        LAST_WAS_START.store(false, Ordering::Relaxed);
    }
}
