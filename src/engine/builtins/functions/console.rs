use bun_engine_text::StringRef;
use bun_engine_vm::{Attributes, ConsoleHooks, MessageLevel, MessageType};

use crate::prelude::*;

macro_rules! functions {
    ($($name:ident: |$cx:ident, $frame:ident, $console:ident| $body:expr,)*) => {
        static_table!(static PROPERTIES = [
            $(StaticProperty::function(names::$name, function::$name, 0).without(Attributes::DONT_ENUM),)*
            StaticProperty::string(symbols::toStringTag, names::console),
        ]);

        #[allow(non_snake_case)]
        mod function {
            use super::*;

            $(
                #[native_abi]
                pub(super) fn $name($cx: &mut Cx, $frame: &CallFrame) -> JsResult<Value> {
                    if let Some($console) = $cx.console() {
                        $body?;
                    }
                    Ok(Value::UNDEFINED)
                }
            )*
        }
    };
}

functions! {
    debug: |cx, frame, console| print(cx, frame, console, MessageLevel::Debug),
    error: |cx, frame, console| print(cx, frame, console, MessageLevel::Error),
    log: |cx, frame, console| print(cx, frame, console, MessageLevel::Log),
    info: |cx, frame, console| print(cx, frame, console, MessageLevel::Info),
    warn: |cx, frame, console| print(cx, frame, console, MessageLevel::Warning),
    clear: |cx, _frame, console| message(cx, console, MessageType::Clear, &[]),
    dir: |cx, frame, console| show(cx, frame, console, MessageType::Dir),
    dirxml: |cx, frame, console| show(cx, frame, console, MessageType::DirXml),
    table: |cx, frame, console| show(cx, frame, console, MessageType::Table),
    trace: |cx, frame, console| message(cx, console, MessageType::Trace, frame.arguments()),
    assert: |cx, frame, console| check(cx, frame, console),
    count: |cx, frame, console| with_label(cx, frame, console.count),
    countReset: |cx, frame, console| with_label(cx, frame, console.count_reset),
    profile: |cx, frame, console| with_title(cx, frame, console.profile),
    profileEnd: |cx, frame, console| with_title(cx, frame, console.profile_end),
    time: |cx, frame, console| with_label(cx, frame, console.time),
    timeLog: |cx, frame, console| {
        with_label(cx, frame, |cx, label| (console.time_log)(cx, label, frame.rest(1)))
    },
    timeEnd: |cx, frame, console| with_label(cx, frame, console.time_end),
    timeStamp: |cx, _frame, _console| Ok(()),
    takeHeapSnapshot: |cx, frame, console| with_title(cx, frame, console.take_heap_snapshot),
    group: |cx, frame, console| message(cx, console, MessageType::StartGroup, frame.arguments()),
    groupCollapsed: |cx, frame, console| {
        message(cx, console, MessageType::StartGroupCollapsed, frame.arguments())
    },
    groupEnd: |cx, frame, console| message(cx, console, MessageType::EndGroup, frame.arguments()),
    record: |cx, _frame, _console| Ok(()),
    recordEnd: |cx, _frame, _console| Ok(()),
    screenshot: |cx, _frame, _console| Ok(()),
}

define_object!(ConsoleObject, "console", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let console = ConsoleObject::create(cx, cx.new_object().into());
    cx.global().init_console_object(console);
}

fn print(
    cx: &mut Cx,
    frame: &CallFrame,
    console: &ConsoleHooks,
    level: MessageLevel,
) -> JsResult<()> {
    (console.message)(cx, MessageType::Log, level, frame.arguments())
}

fn message(
    cx: &mut Cx,
    console: &ConsoleHooks,
    message_type: MessageType,
    arguments: &[Value],
) -> JsResult<()> {
    (console.message)(cx, message_type, MessageLevel::Log, arguments)
}

/// Unless there is nothing to show.
fn show(
    cx: &mut Cx,
    frame: &CallFrame,
    console: &ConsoleHooks,
    message_type: MessageType,
) -> JsResult<()> {
    match frame.arguments() {
        [] => Ok(()),
        arguments => message(cx, console, message_type, arguments),
    }
}

fn check(cx: &mut Cx, frame: &CallFrame, console: &ConsoleHooks) -> JsResult<()> {
    if frame.argument(0).to_boolean(cx) {
        return Ok(());
    }
    (console.message)(cx, MessageType::Assert, MessageLevel::Error, frame.rest(1))
}

fn with_label(
    cx: &mut Cx,
    frame: &CallFrame,
    handle: impl FnOnce(&mut Cx, &StringRef) -> JsResult<()>,
) -> JsResult<()> {
    let label = match frame.argument(0) {
        Value::UNDEFINED => names::default.to_identifier().into_string(),
        label => label.to_string_ref(cx)?,
    };
    handle(cx, &label)
}

fn with_title(
    cx: &mut Cx,
    frame: &CallFrame,
    handle: impl FnOnce(&mut Cx, Option<&StringRef>) -> JsResult<()>,
) -> JsResult<()> {
    let title = match frame.argument(0) {
        Value::UNDEFINED | Value::NULL => None,
        title => Some(title.to_string_ref(cx)?),
    };
    handle(cx, title.as_ref())
}
