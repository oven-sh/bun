//! <https://w3c.github.io/web-locks/>

use bun_web::exec::report;
use bun_web::locks::{Answer, LockInfo, LockMode, LockRequest, Priority};

use super::*;
use crate::api::on_behalf::once;
use crate::api::realm::{promise_for, spawn};

#[repr(C)]
pub(crate) struct Lock {
    name: DomString,
    mode: WebLockMode,
}

impl Lock {
    pub(crate) fn get_name(&self) -> &DomString {
        &self.name
    }

    pub(crate) fn get_mode(&self) -> WebLockMode {
        self.mode
    }
}

const PROMISE: u32 = 0;
const CALLBACK: u32 = 1;

fn settle<'a>(
    cx: Cx<'_, 'a>,
    promise: JSValue,
    outcome: core::result::Result<JSValue, JSValue>,
) -> Result<'a> {
    let promise = JsLocal::new(&cx.heap, promise)
        .as_promise()
        .expect("it was made as one");
    match outcome {
        Ok(value) => promise.resolve(cx, value),
        Err(reason) => promise.reject(cx, reason),
    }
}

/// Until what the callback returns is settled.
fn hold<'a>(
    cx: Cx<'_, 'a>,
    values: List<'a>,
    lock: Option<Lock>,
    request: &Held<LockRequest>,
) -> Result<'a> {
    let lock = lock.map_or(JSValue::NULL, |it| js_WebLock::create(&cx.heap, it).to_js());
    let outcome = match values
        .get(CALLBACK)
        .call(cx.global(), JSValue::UNDEFINED, &[lock])
    {
        Ok(value) => Ok(value),
        Err(error) => Err(cx.catch(error.into())?),
    };
    let waiting = cx.heap.create_promise();
    let [fulfilled, rejected] = [Ok, Err].map(|outcome: fn(JSValue) -> _| {
        let request = Rc::clone(request);
        let release = once(&cx.heap, &[values.get(PROMISE)], move |cx, values| {
            drop(request.take());
            settle(cx, values[0], outcome(values[1]))
        });
        JsLocal::new(&cx.heap, release).as_callable()
    });
    waiting.react(&cx.heap, fulfilled, rejected);
    settle(cx, waiting.to_js(), outcome)
}

impl WebLockManager {
    pub(crate) fn request<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: DomString,
        callback: JsLocal<'a, Callable>,
    ) -> Result<'a, JSValue> {
        self.request_with(
            cx,
            name,
            &LockOptions {
                if_available: false,
                mode: WebLockMode::Exclusive,
                signal: None,
                steal: false,
            },
            callback,
        )
    }

    pub(crate) fn request_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: DomString,
        options: &LockOptions<'a>,
        callback: JsLocal<'a, Callable>,
    ) -> Result<'a, JSValue> {
        let client = client_with_origin(&cx.heap, self.realm(&cx.heap), "Locks")?;
        let LockOptions {
            if_available,
            mode,
            steal,
            ..
        } = *options;
        let signal = options
            .signal
            .and_then(|it| it.as_value().as_abort_signal());
        if name.units().next() == Some(b'-'.into())
            || steal && (if_available || mode != WebLockMode::Exclusive)
            || signal.is_some() && (steal || if_available)
        {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "The name starts with '-', or the options do not go together.",
            ));
        }
        if let Some(signal) = signal.filter(|it| it.is_aborted()) {
            return Err(bindgen::Error::from_value(JsLocal::new(
                &cx.heap,
                signal.reason(&cx.heap),
            )));
        }
        let info = LockInfo {
            client: client.token.clone(),
            name: name.units().collect(),
            mode: if mode == WebLockMode::Shared {
                LockMode::Shared
            } else {
                LockMode::Exclusive
            },
        };
        let priority = if steal {
            Priority::Steals
        } else if if_available {
            Priority::IfAvailable
        } else {
            Priority::Waits
        };
        let (request, answer, theft) = client.locks().request(info, priority);
        let request = realm_of(self.realm(&cx.heap)).hold(request);
        let (promise, is_granted) = (cx.heap.create_promise().to_js(), Rc::new(Cell::new(false)));
        if let Some(signal) = signal {
            let (request, is_granted) = (Rc::clone(&request), Rc::clone(&is_granted));
            let abort = once(&cx.heap, &[promise], move |cx, values| {
                if is_granted.get() {
                    return Ok(());
                }
                drop(request.take());
                settle(cx, values[0], Err(values[1]))
            });
            signal.add_algorithm(
                cx,
                JsLocal::new(&cx.heap, abort)
                    .as_callable()
                    .expect("it was made as one"),
            );
        }
        let values = [promise, callback.to_js()];
        let kept = Kept::new(
            cx,
            List::from_fn(&cx.heap, 2, |at| values[at as usize]).to_js(),
        );
        spawn(&cx.heap, async move {
            let Some(answer) = answer.await else { return };
            kept.queue_task(move |cx, values| {
                if request.borrow().is_some() {
                    is_granted.set(true);
                    let held = hold(
                        cx,
                        List::from_value(values.to_js()),
                        (answer == Answer::Granted).then_some(Lock { name, mode }),
                        &request,
                    );
                    report(cx, held);
                }
            });
            if theft.await.is_some() {
                kept.queue_task(|cx, values| {
                    let error = cx.heap.create_dom_exception(
                        DomError::AbortError,
                        format_args!("Lock broken by another request with the 'steal' option."),
                    );
                    let settled = settle(
                        cx,
                        List::from_value(values.to_js()).get(PROMISE),
                        Err(error.to_js()),
                    );
                    report(cx, settled);
                });
            }
        });
        Ok(promise)
    }

    pub(crate) fn query<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let locks = client_with_origin(&cx.heap, self.realm(&cx.heap), "Locks")?.locks();
        Ok(promise_for(
            cx,
            async move { locks.query() },
            |cx, lists| {
                let (heap, global) = (&cx.heap, global_of(&cx.heap));
                let snapshot = heap.create_empty_object().to_js();
                for (name, list) in ["held", "pending"].into_iter().zip(lists) {
                    let list = heap.create_array(list, |heap, it| {
                        let info = heap.create_empty_object();
                        info.to_js().put(
                            global,
                            b"clientId",
                            heap.create_latin1_string(&it.client).to_js(),
                        );
                        info.to_js().put(
                            global,
                            b"mode",
                            heap.create_latin1_string(it.mode.as_bytes()).to_js(),
                        );
                        info.to_js().put(
                            global,
                            b"name",
                            DomString::from_utf16(&it.name).to_js(heap).to_js(),
                        );
                        Ok(info.as_value())
                    })?;
                    snapshot.put(global, name.as_bytes(), list.to_js());
                }
                Ok(snapshot)
            },
        ))
    }
}
