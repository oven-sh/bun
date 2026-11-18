//! A frontend on the standard streams. A message is a line, and those that go out start with a record separator.

use core::cell::Cell;
use std::io::{BufRead, Write};
use std::rc::Rc;

use bun_engine_inspector::{Controller, Host};
use bun_engine_text::{StringImpl, Text, names};
use bun_engine_vm::{ConsoleHooks, JsFunction, RunLoop, Vm};

use crate::files;
use crate::functions::drain_microtasks;
use crate::prelude::*;

struct Streams {
    is_initialized: Rc<Cell<bool>>,
}

impl Host for Streams {
    fn has_frontend(&self) -> bool {
        true
    }

    fn send(&self, message: &StringImpl) {
        let message = message.text().try_to_utf8().unwrap_or_default();
        let mut out = std::io::stdout().lock();
        let _ = out.write_all(&[b"\x1e", &message[..], b"\n"].concat());
        let _ = out.flush();
    }

    fn dispatch(&self, _: &mut Cx, _: i32, _: Text<'_>, _: Text<'_>) -> bool {
        false
    }

    fn run_while_paused(&self, cx: &mut Cx, is_done: &Cell<bool>) {
        while !is_done.get() && dispatch_next(cx) {}
    }

    fn frontend_initialized(&self) {
        self.is_initialized.set(true);
    }

    fn subtype(&self, _: &mut Cx, _: Value) -> Value {
        Value::UNDEFINED
    }

    fn internal_properties(&self, _: &mut Cx, _: Value) -> JsResult<Option<Value>> {
        Ok(None)
    }
}

pub(crate) fn controller(vm: &Vm) -> Option<Rc<Controller>> {
    State::of(vm).inspector.borrow().clone()
}

/// False once the frontend is gone.
fn dispatch_next(cx: &mut Cx) -> bool {
    let Some(controller) = controller(cx) else {
        return false;
    };
    let mut line = Vec::new();
    let _ = std::io::stdin().lock().read_until(b'\n', &mut line);
    if line.is_empty() {
        State::of(cx).inspector.take();
        controller.will_disconnect_frontend(cx);
        controller.did_disconnect_last_frontend();
        return false;
    }
    controller.dispatch(cx, files::decode(&line).text());
    true
}

fn with_title(
    cx: &mut Cx,
    title: Option<&StringRef>,
    handle: fn(&Controller, &mut Cx, &StringImpl),
) -> JsResult<()> {
    if let Some(controller) = controller(cx) {
        handle(&controller, cx, &title.cloned().unwrap_or_default());
    }
    Ok(())
}

static CONSOLE: ConsoleHooks = ConsoleHooks {
    message: |cx, kind, level, arguments| match controller(cx) {
        Some(controller) => controller.console_message(cx, kind, level, arguments),
        None => Ok(()),
    },
    profile: |cx, title| with_title(cx, title, Controller::console_profile),
    profile_end: |cx, title| with_title(cx, title, Controller::console_profile_end),
    count: |_, _| Ok(()),
    count_reset: |_, _| Ok(()),
    take_heap_snapshot: |_, _| Ok(()),
    time: |_, _| Ok(()),
    time_log: |_, _, _| Ok(()),
    time_end: |_, _| Ok(()),
};

/// So many messages, with the frames of the caller on the stack.
#[native_abi]
fn dispatch_messages(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let count = frame.argument(0).to_uint32(cx)?;
    Ok((0..count).all(|_| dispatch_next(cx)).into())
}

/// Returns when the frontend has sent `Inspector.initialized`.
pub(crate) fn connect(cx: &mut Cx) {
    let is_initialized = Rc::new(Cell::new(false));
    let host = Streams {
        is_initialized: Rc::clone(&is_initialized),
    };
    let controller = Controller::new(cx, Box::new(host));
    controller.did_connect_first_frontend(cx);
    State::of(cx).inspector.replace(Some(controller));
    let global = cx.global();
    cx.embedder().console.set(Some(&CONSOLE));
    (global.console_client()).set(core::ptr::dangling_mut());
    let console = cx.console_object().into();
    global.put_direct(cx, names::console, console, Attributes::DONT_ENUM);
    let name = Identifier::from_literal("dispatchInspectorMessages");
    let function = JsFunction::native(cx, 1, name.string(), dispatch_messages);
    global.put_direct(cx, name.name(), function.into(), Attributes::DONT_ENUM);
    while !is_initialized.get() && dispatch_next(cx) {}
}

/// Until the frontend is gone. Fails only if execution is terminated.
pub(crate) fn serve(cx: &mut Cx, run_loop: &RunLoop) -> JsResult<()> {
    while dispatch_next(cx) {
        drain_microtasks(cx)?;
        run_loop.run(cx)?;
    }
    Ok(())
}
