//! `setTimeout` and `setImmediate`.

use core::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::sync::Arc;

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::ConcurrentTask::{Task, task_tag};
use bun_event_loop::EventLoopTimer::{OwnedTimer, State, Tag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsResult, LoopKind, VmHandle};
use bun_threading::Guarded;

type Work = Box<dyn FnOnce(&JSGlobalObject) -> JsResult<()>>;

#[repr(C)]
struct Armed {
    node: OwnedTimer,
    work: Cell<Option<Work>>,
}

/// Does not keep the process alive. Dropping it cancels it.
#[must_use]
pub struct Timer(*mut Armed);

impl Drop for Timer {
    fn drop(&mut self) {
        // SAFETY: from `after`. `Bun__Ui__fireTimer` is done with it when it does the work.
        unsafe { bun_core::heap::destroy(self.0) };
    }
}

impl Timer {
    pub fn is_pending(&self) -> bool {
        // SAFETY: as above.
        unsafe { &*self.0 }.node.state.get() == State::ACTIVE
    }

    /// Nothing cancels it.
    pub fn detach(self) {
        let mut detached = pending().detached.borrow_mut();
        detached.retain(Timer::is_pending);
        detached.push(self);
    }
}

pub fn after(
    milliseconds: f64,
    work: impl FnOnce(&JSGlobalObject) -> JsResult<()> + 'static,
) -> Timer {
    let node = OwnedTimer::init_paused(Tag::Ui);
    let now = Timespec::now(TimespecMockMode::ForceRealTime);
    node.next.set(now.add_ms(milliseconds.max(1.) as i64));
    let work = Cell::new(Some(Box::new(work) as Work));
    let armed = bun_core::heap::into_raw(Box::new(Armed { node, work }));
    // SAFETY: it stays where it is, and leaves the heap when it is dropped.
    unsafe { VirtualMachine::get().timer_insert(OwnedTimer::node(&raw const (*armed).node)) };
    Timer(armed)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Ui__fireTimer(node: *mut core::ffi::c_void) {
    // SAFETY: the tag says that it is the first field of an `Armed`.
    let armed = unsafe { &*node.cast::<Armed>() };
    armed.node.state.set(State::FIRED);
    if let Some(work) = armed.work.take() {
        run(crate::main_global(), work);
    }
}

fn run(global: &JSGlobalObject, work: Work) {
    if global.bun_vm().script_allowed() {
        let _entered = global.bun_vm().event_loop().enter_scope();
        let _ = crate::report(global, work(global));
    }
}

type Inbox = Arc<Guarded<Vec<Box<dyn FnOnce(&JSGlobalObject) -> JsResult<()> + Send>>>>;

/// [`soon`], from another thread.
pub struct Remote(VmHandle, Inbox);

impl Remote {
    pub fn to_this_thread() -> Self {
        Remote(VirtualMachine::get().handle(), Arc::clone(&pending().inbox))
    }

    pub fn post(&self, work: impl FnOnce(&JSGlobalObject) -> JsResult<()> + Send + 'static) {
        self.1.lock().push(Box::new(work));
        let task = core::ptr::dangling_mut::<EventsTask>();
        let _ = self.0.post(LoopKind::Regular, task);
    }
}

#[derive(Default)]
struct Pending {
    inbox: Inbox,
    detached: RefCell<Vec<Timer>>,
    soon: RefCell<VecDeque<Work>>,
}

crate::state!(fn pending() -> Pending);

struct EventsTask;

impl bun_event_loop::Taskable for EventsTask {
    const TAG: bun_event_loop::TaskTag = task_tag::DesktopEventsTask;
    /// Nothing is owned.
    unsafe fn release_unrun(_: *mut Self) {}
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

pub(crate) fn handle_events_soon() {
    let task = Task::init(core::ptr::dangling_mut::<EventsTask>());
    VirtualMachine::get()
        .event_loop()
        .enqueue_task_after_yield(task);
}

pub fn soon(work: impl FnOnce(&JSGlobalObject) -> JsResult<()> + 'static) {
    pending().soon.borrow_mut().push_back(Box::new(work));
    handle_events_soon();
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Ui__handleEvents(global: &JSGlobalObject) {
    let soon = &pending().soon;
    let received = core::mem::take(&mut *pending().inbox.lock());
    soon.borrow_mut()
        .extend(received.into_iter().map(|it| it as Work));
    let due = soon.borrow().len();
    for _ in 0..due {
        let Some(work) = soon.borrow_mut().pop_front() else {
            break;
        };
        run(global, work);
    }
    run(global, Box::new(crate::queue::handle_events));
}
