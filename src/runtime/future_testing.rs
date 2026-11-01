//! `futures` of `bun:internal-for-testing`: small `async` bodies over each thing a future on the
//! JS loop can await. See `test/internal/rust-future.test.ts`.

use core::future::poll_fn;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::rc::Rc;

use bun_async::{Either, Slot, race};
use bun_jsc::array_buffer::PinnedArrayBuffer;
use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use bun_jsc::future::{self, JsTask, Rejection};
use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, JsPtr, JsResult, StringJsc as _, Strong};

use crate::future::{settled as settled_promise, sleep as sleep_for};

static ALIVE: AtomicUsize = AtomicUsize::new(0);

/// Held by each future below, so a test can see that one was dropped.
struct Alive;
impl Alive {
    fn new() -> Self {
        ALIVE.fetch_add(1, Ordering::Relaxed);
        Self
    }
}
impl Drop for Alive {
    fn drop(&mut self) {
        ALIVE.fetch_sub(1, Ordering::Relaxed);
    }
}

pub(crate) fn alive() -> usize {
    ALIVE.load(Ordering::Relaxed)
}

pub(crate) fn add(cx: &mut JsScope<'_>, a: i32, b: i32) -> JsResult<JSValue> {
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        let sum = js.blocking(move || a.wrapping_add(b)).await;
        Ok(JSValue::js_number_from_int32(sum))
    })
}

struct AddJob {
    a: i32,
    b: i32,
    sum: i32,
}
impl bun_jsc::JobContext for AddJob {
    type OffThread = Self;
    type Js = JSPromiseStrong;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.sum = this.a.wrapping_add(this.b);
        Some(done)
    }
    fn then(this: Self, mut promise: JSPromiseStrong, cx: &bun_jsc::JsThread<'_>) -> JsResult<()> {
        promise.resolve(cx.global(), JSValue::js_number_from_int32(this.sum))
    }
}

pub(crate) fn add_with_job(cx: &mut JsScope<'_>, a: i32, b: i32) -> JsResult<JSValue> {
    let cx = cx.js_thread();
    let promise = JSPromiseStrong::init(cx.global());
    let value = promise.value();
    bun_jsc::Job::<AddJob>::schedule(&cx, AddJob { a, b, sum: 0 }, promise);
    Ok(value)
}

pub(crate) fn fan_out(cx: &mut JsScope<'_>, count: u32) -> JsResult<JSValue> {
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        let terms: Vec<_> = (0..count)
            .map(|i| js.blocking(move || f64::from(i)))
            .collect();
        let mut sum = 0.0;
        for term in terms {
            sum += term.await;
        }
        Ok(JSValue::js_number(sum))
    })
}

pub(crate) fn ready(cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<JSValue> {
    let value = Strong::create(value.to_js(), cx.global());
    future::promise(&cx.js_thread(), |_| async move { Ok(value.get()) })
}

pub(crate) fn sleep(cx: &mut JsScope<'_>, ms: u32) -> JsResult<JSValue> {
    future::promise(&cx.js_thread(), |_| async move {
        let _alive = Alive::new();
        sleep_for(ms).await;
        Ok(JSValue::UNDEFINED)
    })
}

pub(crate) fn block(cx: &mut JsScope<'_>, ms: u32) -> JsResult<JSValue> {
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        js.blocking(move || std::thread::sleep(core::time::Duration::from_millis(u64::from(ms))))
            .await;
        Ok(JSValue::UNDEFINED)
    })
}

fn outcome(global: &JSGlobalObject, how: &'static str, value: JSValue) -> JsResult<JSValue> {
    let pair = JSValue::create_empty_array(global, 2)?;
    pair.put_index(global, 0, bun_core::String::static_(how).to_js(global)?)?;
    pair.put_index(global, 1, value)?;
    Ok(pair)
}

pub(crate) fn settled(cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<JSValue> {
    let awaited = settled_promise(cx.global(), value.to_js())?;
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        Ok(match awaited.await {
            Ok(value) => outcome(js.global(), "fulfilled", value)?,
            Err(reason) => outcome(js.global(), "rejected", reason)?,
        })
    })
}

pub(crate) fn sequence(
    cx: &mut JsScope<'_>,
    callback: JsLocal<'_, Callable>,
    count: u32,
) -> JsResult<JSValue> {
    let callback = Strong::create(callback.to_js(), cx.global());
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        let mut sum = 0.0;
        for i in 0..count {
            let returned = callback.get().call(
                js.global(),
                JSValue::UNDEFINED,
                &[JSValue::js_number(f64::from(i))],
            )?;
            let returned = settled_promise(js.global(), returned)?;
            match returned.await {
                Ok(value) => sum += value.to_number(js.global())?,
                Err(reason) => return Err(Rejection::Value(reason)),
            }
        }
        Ok(JSValue::js_number(sum))
    })
}

pub(crate) fn with_timeout(cx: &mut JsScope<'_>, value: JsLocal<'_>, ms: u32) -> JsResult<JSValue> {
    let awaited = settled_promise(cx.global(), value.to_js())?;
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        match race(awaited, sleep_for(ms)).await {
            Either::Left(Ok(value)) => Ok(value),
            Either::Left(Err(reason)) => Err(Rejection::Value(reason)),
            Either::Right(()) => Ok(bun_core::String::static_("timed out").to_js(js.global())?),
        }
    })
}

pub(crate) fn call_after(
    cx: &mut JsScope<'_>,
    callback: JsLocal<'_, Callable>,
    ms: u32,
) -> JsResult<JSValue> {
    let callback = Strong::create(callback.to_js(), cx.global());
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        sleep_for(ms).await;
        Ok(callback.get().call(js.global(), JSValue::UNDEFINED, &[])?)
    })
}

pub(crate) fn shout(cx: &mut JsScope<'_>, text: bun_core::Utf8Bytes<'static>) -> JsResult<JSValue> {
    let text = text.into_vec();
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        let loud = js.blocking(move || text.to_ascii_uppercase()).await;
        js.scope(|cx| match cx.heap.create_utf8_string(&loud) {
            Ok(string) => Ok(string.to_js()),
            Err(error) => Err(error.into_js_error(cx.global()).into()),
        })
    })
}

fn sum_in_place(js: JsTask, buffer: JSValue, ms: u32) -> Option<future::Blocking<u32>> {
    let pinned = PinnedArrayBuffer::root_read_only(js.global(), buffer)?;
    // SAFETY: `pinned`, which the job keeps, keeps the bytes where they are.
    let bytes = unsafe { JsPtr::new(core::ptr::NonNull::from(pinned.byte_slice())) };
    Some(js.blocking_with(pinned, move |_vm_is_alive| {
        std::thread::sleep(std::time::Duration::from_millis(u64::from(ms)));
        // SAFETY: the job holds a ticket and `pinned`, and the test does not write to the buffer.
        let bytes: &[u8] = unsafe { &*bytes.as_ptr() };
        bytes.iter().map(|byte| u32::from(*byte)).sum()
    }))
}

pub(crate) fn sum_bytes(cx: &mut JsScope<'_>, buffer: JsLocal<'_>, ms: u32) -> JsResult<JSValue> {
    let buffer = buffer.to_js();
    future::promise(&cx.js_thread(), |js| {
        let sum = sum_in_place(js, buffer, ms);
        async move {
            let _alive = Alive::new();
            match sum {
                Some(sum) => Ok(JSValue::js_number(f64::from(sum.await))),
                None => Ok(JSValue::NULL),
            }
        }
    })
}

pub(crate) fn sum_bytes_abandoned(
    cx: &mut JsScope<'_>,
    buffer: JsLocal<'_>,
    ms: u32,
) -> JsResult<()> {
    let buffer = buffer.to_js();
    future::spawn(&cx.js_thread(), |js| {
        drop(sum_in_place(js, buffer, ms));
        async { Ok(()) }
    })
}

pub(crate) fn nested(cx: &mut JsScope<'_>, value: i32) -> JsResult<JSValue> {
    future::promise(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        let left_behind = Rc::new(Slot::new());
        future::spawn(&js.thread(), |js| {
            let left_behind = Rc::clone(&left_behind);
            async move {
                let _alive = Alive::new();
                left_behind.fill(js.blocking(move || value.wrapping_mul(2)).await);
                Ok(())
            }
        })?;
        let doubled = poll_fn(|cx| left_behind.poll_take(cx)).await;
        Ok(JSValue::js_number_from_int32(doubled))
    })
}

pub(crate) fn detached(
    cx: &mut JsScope<'_>,
    callback: JsLocal<'_, Callable>,
    ms: u32,
) -> JsResult<()> {
    let callback = Strong::create(callback.to_js(), cx.global());
    future::spawn(&cx.js_thread(), |js| async move {
        let _alive = Alive::new();
        sleep_for(ms).await;
        callback.get().call(js.global(), JSValue::UNDEFINED, &[])?;
        Ok(())
    })
}
