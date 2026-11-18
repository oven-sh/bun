//! `$262.agent`: threads that have a `Vm` each, and share memory.

use core::sync::atomic::{AtomicUsize, Ordering};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, mpsc};

use bun_engine_text::SharedString;
use bun_engine_vm::{
    ArrayBufferContents, ElementType, JsArrayBuffer, JsBigInt, JsTypedArray,
    SharedArrayBufferContents, SourceType, evaluate_script, waiter_count,
};
use bun_engine_wasm::{
    WasmModule, WasmSharedMemory, memory_object, memory_share, module_object, module_of_object,
};

use super::tasks::{monotonic_now, sleep_milliseconds};
use super::{return_undefined, to_text};
use crate::prelude::*;
use crate::{files, run};

pub(super) const FUNCTIONS: Functions = &[
    ("start", start, 1),
    ("receiveBroadcast", receive_broadcast, 1),
    ("report", report, 1),
    ("sleep", sleep_milliseconds, 1),
    ("broadcast", broadcast, 1),
    ("getReport", get_report, 0),
    ("leaving", return_undefined, 0),
    ("monotonicNow", monotonic_now, 0),
];

pub(super) const GLOBAL_FUNCTIONS: Functions = &[
    ("waitForReport", wait_for_report, 0),
    ("waiterListSize", waiter_list_size, 2),
];

#[derive(Clone)]
enum Message {
    /// The bits of a value that is no cell.
    Immediate(u64),
    String(SharedString),
    BigInt(SharedString),
    Memory(Arc<SharedArrayBufferContents>),
    WasmMemory(Arc<WasmSharedMemory>),
    WasmModule(Arc<WasmModule>),
}

struct Mailroom {
    inboxes: BTreeMap<usize, VecDeque<(Message, i32)>>,
    reports: VecDeque<SharedString>,
}

static MAILROOM: Mutex<Mailroom> = Mutex::new(Mailroom {
    inboxes: BTreeMap::new(),
    reports: VecDeque::new(),
});
static DELIVERED: Condvar = Condvar::new();

fn mailroom() -> MutexGuard<'static, Mailroom> {
    MAILROOM.lock().unwrap_or_else(PoisonError::into_inner)
}

fn wait_for<T>(mut take: impl FnMut(&mut Mailroom) -> Option<T>) -> T {
    let mut mailroom = mailroom();
    loop {
        if let Some(delivery) = take(&mut mailroom) {
            return delivery;
        }
        mailroom = (DELIVERED.wait(mailroom)).unwrap_or_else(PoisonError::into_inner);
    }
}

/// An agent gets broadcasts while it has one.
pub(crate) struct Inbox(usize);

impl Default for Inbox {
    fn default() -> Inbox {
        static COUNT: AtomicUsize = AtomicUsize::new(0);
        let number = COUNT.fetch_add(1, Ordering::Relaxed);
        mailroom().inboxes.insert(number, VecDeque::new());
        Inbox(number)
    }
}

impl Drop for Inbox {
    fn drop(&mut self) {
        mailroom().inboxes.remove(&self.0);
    }
}

#[native_abi]
fn start(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    const STACK_SIZE: usize = 8 << 20;
    let text = StringRef::isolated_copy(&*frame.argument(0).to_string_ref(cx)?);
    let url = match frame.argument(1) {
        Value::UNDEFINED => "worker".to_owned(),
        url => to_text(cx, url)?,
    };
    let command_line = State::of(cx).command_line().for_worker();
    let (did_start, started) = mpsc::channel();
    let body = move |cx: &mut Cx| {
        let _ = did_start.send(());
        let origin = files::origin(&url);
        let source = files::source(text.into_string(), Some(&origin), None, SourceType::Program);
        let result = evaluate_script(cx, &source, Value::UNDEFINED);
        let exception = run::take_exception(cx, result);
        run::check_exception(cx, exception, true);
        if State::of(cx).has_failed.get() {
            run::exit(1);
        }
    };
    let thread = std::thread::Builder::new().stack_size(STACK_SIZE);
    if (thread.spawn(move || run::run(&command_line, body))).is_err() {
        return Err(cx.throw_out_of_memory_with("Out of memory: Failed to create agent thread"));
    }
    let _ = started.recv();
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn broadcast(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (value, number) = (frame.argument(0), frame.argument(1).to_int32(cx)?);
    let buffer = value.downcast::<JsArrayBuffer>();
    let message = if !value.is_cell() {
        Message::Immediate(value.to_bits())
    } else if value.is_string() {
        Message::String(StringRef::to_shared(&*value.to_string_ref(cx)?))
    } else if value.is_bigint() {
        Message::BigInt(StringRef::to_shared(&*value.to_string_ref(cx)?))
    } else if let Some(memory) = buffer.and_then(|it| it.buffer().shared_contents()) {
        Message::Memory(memory)
    } else if let Some(memory) = value.as_object().and_then(|it| memory_share(&it)) {
        Message::WasmMemory(memory)
    } else if let Some(module) = value.as_object().and_then(|it| module_of_object(&it)) {
        Message::WasmModule(module)
    } else {
        return Err(cx.throw_type_error("Value could not be cloned."));
    };
    let own = State::of(cx).inbox.0;
    for (_, inbox) in (mailroom().inboxes.iter_mut()).filter(|it| *it.0 != own) {
        inbox.push_back((message.clone(), number));
    }
    DELIVERED.notify_all();
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn receive_broadcast(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let callback = frame.argument(0);
    if !callback.is_callable() {
        return Err(cx.throw_error(ErrorType::Error, "Expected callback"));
    }
    let own = State::of(cx).inbox.0;
    let (message, number) = wait_for(|it| it.inboxes.get_mut(&own)?.pop_front());
    let value = match message {
        // SAFETY: those of a value that has no cell.
        Message::Immediate(bits) => unsafe { Value::from_bits(bits) },
        Message::String(text) => cx.new_string(text.text())?.into(),
        Message::BigInt(text) => {
            let digits: Value = cx.new_string(text.text())?.into();
            let bigint: Gc<JsBigInt> = digits.to_bigint(cx)?;
            bigint.into()
        }
        Message::Memory(memory) => {
            let contents = ArrayBufferContents::shared(memory, false);
            JsArrayBuffer::from_contents(cx, cx.shared_array_buffer_shape(), contents)?.into()
        }
        Message::WasmMemory(memory) => memory_object(cx, &memory).into(),
        Message::WasmModule(module) => module_object(cx, module).into(),
    };
    cx.call(callback, Value::NULL, &[value, number.into()])
}

#[native_abi]
fn report(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = StringRef::to_shared(&*frame.argument(0).to_string_ref(cx)?);
    mailroom().reports.push_back(text);
    DELIVERED.notify_all();
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn get_report(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let report = mailroom().reports.pop_front();
    match report {
        Some(text) => cx.new_string(text.text()).map(Into::into),
        None => Ok(Value::NULL),
    }
}

#[native_abi]
fn wait_for_report(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let text = wait_for(|it| it.reports.pop_front());
    cx.new_string(text.text()).map(Into::into)
}

#[native_abi]
fn waiter_list_size(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, length) = JsTypedArray::validate_value(cx, frame.argument(0))?;
    if !matches!(
        array.element_type(),
        ElementType::Int32 | ElementType::BigInt64
    ) {
        let message = "Typed array argument must be an Int32Array or BigInt64Array.";
        return Err(cx.throw_type_error(message));
    }
    if !array.is_shared() {
        let message = "Typed array for waiterListSize must wrap a SharedArrayBuffer.";
        return Err(cx.throw_type_error(message));
    }
    let index = frame.argument(1).to_index(cx, "accessIndex")? as usize;
    if index >= length {
        return Err(cx.throw_range_error("Access index out of bounds for atomic access."));
    }
    Ok(waiter_count(Some(array.address_of_shared_element(index))).into())
}
