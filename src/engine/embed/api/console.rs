//! What `console` asks of the `ConsoleClient` of the global object.

use bun_engine_text::{StringImpl, StringRef};
use bun_engine_vm::{ConsoleHooks, Cx, JsResult, MessageLevel, MessageType, Value};

unsafe extern "C" {
    fn engine_host_console_message(
        cx: &mut Cx,
        message_type: MessageType,
        level: MessageLevel,
        arguments: *const Value,
        count: usize,
    );
    fn engine_host_console_time_log(
        cx: &mut Cx,
        label: &StringImpl,
        arguments: *const Value,
        count: usize,
    );
    safe fn engine_host_console_count(cx: &mut Cx, label: Option<&StringImpl>);
    safe fn engine_host_console_count_reset(cx: &mut Cx, label: Option<&StringImpl>);
    safe fn engine_host_console_profile(cx: &mut Cx, title: Option<&StringImpl>);
    safe fn engine_host_console_profile_end(cx: &mut Cx, title: Option<&StringImpl>);
    safe fn engine_host_console_take_heap_snapshot(cx: &mut Cx, title: Option<&StringImpl>);
    safe fn engine_host_console_time(cx: &mut Cx, label: Option<&StringImpl>);
    safe fn engine_host_console_time_end(cx: &mut Cx, label: Option<&StringImpl>);
}

fn pass_text(
    cx: &mut Cx,
    text: Option<&StringRef>,
    function: extern "C" fn(&mut Cx, Option<&StringImpl>),
) -> JsResult<()> {
    function(cx, text.map(|it| &**it));
    cx.check_exception()
}

pub(super) static CONSOLE_HOOKS: ConsoleHooks = ConsoleHooks {
    message: |cx, message_type, level, arguments| {
        let (first, count) = (arguments.as_ptr(), arguments.len());
        // SAFETY: a slice.
        unsafe { engine_host_console_message(cx, message_type, level, first, count) };
        cx.check_exception()
    },
    count: |cx, label| pass_text(cx, Some(label), engine_host_console_count),
    count_reset: |cx, label| pass_text(cx, Some(label), engine_host_console_count_reset),
    profile: |cx, title| pass_text(cx, title, engine_host_console_profile),
    profile_end: |cx, title| pass_text(cx, title, engine_host_console_profile_end),
    take_heap_snapshot: |cx, title| pass_text(cx, title, engine_host_console_take_heap_snapshot),
    time: |cx, label| pass_text(cx, Some(label), engine_host_console_time),
    time_log: |cx, label, arguments| {
        // SAFETY: a slice.
        unsafe { engine_host_console_time_log(cx, label, arguments.as_ptr(), arguments.len()) };
        cx.check_exception()
    },
    time_end: |cx, label| pass_text(cx, Some(label), engine_host_console_time_end),
};
