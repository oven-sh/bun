//! Decides where scripts pause.

mod breakpoint;
mod events;
mod pause;
mod requests;
mod scope;
mod script;

use core::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;

use bun_engine_vm::{Coroutine, FastHashMap, FastHashSet, Vm, Weak};

pub(crate) use breakpoint::{Breakpoint, Options};
pub(crate) use events::Attachment;
pub(crate) use pause::Reason;
pub(crate) use requests::Step;
pub(crate) use script::{Location, Position, Script};

use crate::call_stack::AsyncCalls;
use pause::Announcement;
use requests::{Blackbox, SymbolicBreakpoint, UrlBreakpoint};

type Slot<T> = RefCell<Option<Rc<T>>>;

/// When `Debugger.resumed` is due.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum Resumed {
    #[default]
    NotDue,
    /// A step has led nowhere.
    WhenIdle,
    WhenContinued,
}

/// A step that goes on where the coroutine does.
struct Suspension {
    coroutine: Weak<Coroutine>,
    /// When, if it awaits.
    awaits_since: Option<f64>,
    pauses_at_expressions: bool,
}

struct Microtask {
    /// The entry frame that it was started from, if it turns exceptions into rejections.
    catches_for: Option<usize>,
    /// For `did_evaluate_script`.
    start: Option<f64>,
}

#[derive(Default)]
pub(crate) struct Debugger {
    is_enabled: Cell<bool>,
    breakpoints_are_active: Cell<bool>,
    pub(crate) async_calls: AsyncCalls,

    scripts: RefCell<BTreeMap<usize, Rc<Script>>>,
    failed_scripts: RefCell<FastHashSet<usize>>,
    blackboxes: RefCell<Vec<Blackbox>>,
    blackboxes_evaluations: Cell<bool>,

    /// By script.
    breakpoints: RefCell<FastHashMap<usize, Vec<Rc<Breakpoint>>>>,
    url_breakpoints: RefCell<Vec<Rc<UrlBreakpoint>>>,
    symbolic_breakpoints: RefCell<Vec<SymbolicBreakpoint>>,
    destination: Slot<Breakpoint>,
    pub(crate) on_debugger_statements: Slot<Breakpoint>,
    pub(crate) on_all_exceptions: Slot<Breakpoint>,
    pub(crate) on_uncaught_exceptions: Slot<Breakpoint>,
    pub(crate) on_assertions: Slot<Breakpoint>,
    pub(crate) on_microtasks: Slot<Breakpoint>,
    ignores_exceptions: Cell<bool>,
    /// How many calls on the stack report what is thrown to the frontend.
    pub(crate) catching_calls: Cell<u32>,
    /// Those that are running.
    microtasks: RefCell<Vec<Microtask>>,

    is_stepping: Cell<bool>,
    pauses_at_next_opportunity: Cell<bool>,
    /// The address of the frame to pause in, or zero.
    target_frame: Cell<usize>,
    pauses_at_expressions: Cell<bool>,
    is_past_first_expression: Cell<bool>,
    is_after_blackboxed_script: Cell<bool>,
    is_after_await: Cell<bool>,
    suspension: RefCell<Option<Suspension>>,
    /// Has one opportunity to pause.
    pending_breakpoint: Slot<Breakpoint>,
    deferred_breakpoints: RefCell<Vec<Rc<Breakpoint>>>,
    last_line: Cell<Option<(usize, i32)>>,

    /// Also while the condition of a breakpoint is evaluated.
    is_paused: Cell<bool>,
    /// The address of the innermost, while the frontend knows of the pause. Zero if no script is running.
    paused_frame: Cell<Option<usize>>,
    is_done_pausing: Cell<bool>,
    is_pause_requested: Cell<bool>,
    pauses_when_idle: Cell<bool>,
    waits_for_idle: Cell<bool>,
    resumed: Cell<Resumed>,
    announcement: RefCell<Announcement>,
    last_announcement: RefCell<Announcement>,
    last_probe_batch: Cell<u32>,
    last_probe_sample: Cell<u32>,
}

impl Debugger {
    pub(crate) fn is_enabled(&self) -> bool {
        self.is_enabled.get()
    }

    pub(crate) fn is_paused(&self) -> bool {
        self.is_paused.get()
    }

    pub(crate) fn breakpoints_are_active(&self) -> bool {
        self.breakpoints_are_active.get()
    }

    pub(crate) fn script(&self, id: usize) -> Option<Rc<Script>> {
        self.scripts.borrow().get(&id).cloned()
    }

    pub(crate) fn set_blackboxes_evaluations(&self, value: bool) {
        self.blackboxes_evaluations.set(value);
    }

    pub(crate) fn ignoring_exceptions_if<T>(&self, ignores: bool, run: impl FnOnce() -> T) -> T {
        let did_ignore = self.ignores_exceptions.get();
        self.ignores_exceptions.set(did_ignore || ignores);
        let result = run();
        self.ignores_exceptions.set(did_ignore);
        result
    }

    /// Whether every debug hook calls.
    fn set_stepping(&self, vm: &Vm, is_stepping: bool) {
        if self.is_stepping.replace(is_stepping) != is_stepping {
            let count = vm.stepping_debugger_count();
            count.update(|count| if is_stepping { count + 1 } else { count - 1 });
        }
    }

    fn stop_stepping_if_done(&self, vm: &Vm) {
        if !self.pauses_at_next_opportunity.get()
            && self.target_frame.get() == 0
            && self.pending_breakpoint.borrow().is_none()
            && self.suspension.borrow().is_none()
        {
            self.set_stepping(vm, false);
        }
    }

    fn pause_at_next_opportunity(&self, vm: &Vm) {
        self.pauses_at_next_opportunity.set(true);
        self.set_stepping(vm, true);
    }

    fn forget_immediate_pause(&self) {
        self.pauses_at_next_opportunity.set(false);
        self.is_after_blackboxed_script.set(false);
        self.pending_breakpoint.take();
    }

    fn forget_target_frame(&self) {
        self.target_frame.set(0);
        self.pauses_at_expressions.set(false);
    }

    fn forget_suspension(&self) {
        self.suspension.take();
        self.is_after_await.set(false);
    }

    /// A step over an `await` goes on.
    fn forget_steps(&self) {
        self.forget_immediate_pause();
        self.forget_target_frame();
        self.deferred_breakpoints.take();
        (self.suspension.borrow_mut()).take_if(|it| it.awaits_since.is_none());
    }

    pub(crate) fn continue_program(&self) {
        self.forget_steps();
        self.is_done_pausing.set(true);
    }
}
