//! <https://html.spec.whatwg.org/#timers>

use core::cell::{Cell, RefCell};

use bun_collections::HashMap;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use smallvec::SmallVec;

use crate::realm::Realm;
use crate::tasks::{self, TaskId, Work};

const NESTING_WITHOUT_LIMIT: u32 = 5;
const SHORTEST_NESTED_TIMEOUT: i32 = 4;

#[derive(Clone, Copy)]
struct Timer {
    task: TaskId,
    nesting: u32,
    timeout: i32,
    repeats: bool,
}

#[derive(Default)]
pub(crate) struct Timers {
    active: RefCell<HashMap<i32, Timer>>,
    last_id: Cell<i32>,
}

impl Timers {
    pub(crate) fn clear(&self) {
        self.active.take();
    }
}

fn run(global: &JSGlobalObject, id: u64, values: &[JSValue]) -> JsResult<()> {
    let Some(realm) = Realm::of(global) else {
        return Ok(());
    };
    let (timers, id) = (&realm.timers, id as i32);
    let mut active = timers.active.borrow_mut();
    let Some(timer) = active.get_mut(&id) else {
        return Ok(());
    };
    let nesting = timer.nesting;
    if !timer.repeats {
        active.remove(&id);
    } else if timer.timeout < SHORTEST_NESTED_TIMEOUT {
        timer.nesting += 1;
        if nesting > NESTING_WITHOUT_LIMIT {
            timer.timeout = SHORTEST_NESTED_TIMEOUT;
            tasks::set_interval(global, timer.task, f64::from(timer.timeout));
        }
    }
    drop(active);
    tasks::nesting_of_timers(global).set(nesting);
    let result = if values[0].is_string() {
        (values[1].to_utf8(global))
            .and_then(|url| realm.evaluate(values[0], &url, &values[2].to_utf8(global)?))
    } else {
        values[0].call(global, realm.global_this(), &values[1..])
    };
    match result {
        Err(error) if values[0].is_object() => {
            // SAFETY: the function keeps its realm alive.
            let own = unsafe { &*Bun__Bindgen__realmOf(values[0]) };
            if Realm::of(own).is_none_or(Realm::is_stopped) {
                return Err(error);
            }
            _ = bun_jsc::task::report_error_or_terminate(own, error);
            Ok(())
        }
        result => result.map(drop),
    }
}

unsafe extern "C" {
    fn Bun__Bindgen__realmOf(object: JSValue) -> *const JSGlobalObject;
}

/// <https://html.spec.whatwg.org/#timer-initialisation-steps>. `handler` is a function with its arguments, or the text of a script
/// with its URL.
pub fn start(
    global: &JSGlobalObject,
    handler: JSValue,
    mut timeout: i32,
    arguments: &[JSValue],
    repeats: bool,
) -> JsResult<i32> {
    let Some(realm) = Realm::of(global) else {
        return Ok(0);
    };
    let mut values: SmallVec<[JSValue; 4]> = SmallVec::new();
    values.push(handler);
    values.extend_from_slice(arguments);
    let timers = &realm.timers;
    let id = timers.last_id.get().checked_add(1).unwrap_or(1);
    timers.last_id.set(id);
    if realm.is_stopped() {
        return Ok(id);
    }
    let nesting = tasks::nesting_of_timers(global).get();
    if nesting >= NESTING_WITHOUT_LIMIT {
        timeout = timeout.max(SHORTEST_NESTED_TIMEOUT);
    }
    let work = Work::Function(run, id as u64);
    let timer = Timer {
        task: tasks::post_delayed(global, f64::from(timeout), repeats, work, &values),
        nesting: nesting.saturating_add(1),
        timeout,
        repeats,
    };
    timers.active.borrow_mut().insert(id, timer);
    Ok(id)
}

pub fn is_active(global: &JSGlobalObject, id: i32) -> bool {
    Realm::of(global).is_some_and(|realm| realm.timers.active.borrow().contains_key(&id))
}

pub fn clear(global: &JSGlobalObject, id: i32) {
    let timer = Realm::of(global).and_then(|realm| realm.timers.active.borrow_mut().remove(&id));
    if let Some(timer) = timer {
        tasks::cancel(global, timer.task);
    }
}
