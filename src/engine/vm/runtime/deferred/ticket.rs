use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};

use super::Host;
use crate::heap::Survivors;
use crate::{
    Cx, Gc, GcFree, GlobalObject, JsCell, JsFinalizationRegistry, JsObject, JsResult, Visitor, Vm,
};

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum WorkKind {
    /// Worth waiting for.
    ImminentlyScheduled,
    AtSomePoint,
}

/// Stands for work that will end with a task on the thread of the `Vm`. Its cells live as long as the realm, and the
/// ticket is cancelled if that dies.
pub struct Ticket {
    kind: WorkKind,
    /// A script is about to hear of the result.
    keeps_realm: bool,
    is_cancelled: AtomicBool,
    host: Arc<Host>,
    realm: usize,
    script_execution_owner: usize,
    target: usize,
    dependencies: Box<[usize]>,
}

impl Ticket {
    pub fn kind(&self) -> WorkKind {
        self.kind
    }

    pub fn is_cancelled(&self) -> bool {
        self.is_cancelled.load(Ordering::Acquire)
    }

    /// Whether it had not been cancelled yet.
    pub fn cancel(&self) -> bool {
        let is_first = !self.is_cancelled.swap(true, Ordering::AcqRel);
        if is_first {
            self.host.with_event_loop(|it| it.cancel_pending_work(self));
        }
        is_first
    }

    /// # Safety
    /// One of those of the ticket, and a `T`.
    unsafe fn cell<T>(&self, vm: &Vm, address: usize) -> Option<Gc<T>> {
        assert!(Arc::ptr_eq(&self.host, &vm.services.deferred.host));
        // SAFETY: each collection so far has marked it. The next one is on this thread, and finds it on the stack.
        (!self.is_cancelled()).then(|| unsafe { Gc::from_address(address) })
    }

    /// `None` once it is cancelled. Panics for another `Vm`. So for those that follow.
    pub fn realm(&self, vm: &Vm) -> Option<Gc<GlobalObject>> {
        // SAFETY: what it was made from.
        unsafe { self.cell(vm, self.realm) }
    }

    pub fn script_execution_owner(&self, vm: &Vm) -> Option<Gc<JsObject>> {
        // SAFETY: as above.
        unsafe { self.cell(vm, self.script_execution_owner) }
    }

    pub fn target(&self, vm: &Vm) -> Option<Gc<JsObject>> {
        // SAFETY: as above.
        unsafe { self.cell(vm, self.target) }
    }

    /// Panics past the end.
    pub fn dependency(&self, vm: &Vm, index: usize) -> Option<Gc<JsCell>> {
        // SAFETY: as above.
        unsafe { self.cell(vm, self.dependencies[index]) }
    }

    /// The address of the target, whether it is alive or not.
    pub fn target_address(&self) -> usize {
        self.target
    }

    /// As above.
    pub fn script_execution_owner_address(&self) -> usize {
        self.script_execution_owner
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        if self.is_cancelled() || !(self.keeps_realm || visitor.is_address_marked(self.realm)) {
            return;
        }
        let cells = [self.realm, self.script_execution_owner, self.target];
        for &cell in cells.iter().chain(&self.dependencies) {
            // SAFETY: it was not cancelled during any collection so far.
            unsafe { visitor.append_word(cell as u64) };
        }
    }

    pub(super) fn has_survived(&self, survivors: &Survivors) -> bool {
        !self.is_cancelled() && survivors.contains_address(self.realm)
    }
}

type TaskBody = dyn FnOnce(&mut Cx, &Ticket) -> JsResult<()> + Send + GcFree;

/// It may be dropped, on any thread, without having run.
pub struct DeferredTask(Box<TaskBody>);

impl DeferredTask {
    /// In the realm of the ticket, unless that is cancelled.
    pub fn run(self, cx: &mut Cx, ticket: &Ticket) -> JsResult<()> {
        match ticket.realm(cx) {
            Some(realm) => (self.0)(cx.in_realm(realm), ticket),
            None => Ok(()),
        }
    }
}

/// What whoever does the work has, on any thread.
#[derive(Clone, Default)]
pub struct WeakTicket(Weak<Ticket>);

impl WeakTicket {
    pub fn upgrade(&self) -> Option<Arc<Ticket>> {
        self.0.upgrade()
    }

    /// Neither done nor cancelled.
    pub fn is_active(&self) -> bool {
        self.upgrade().is_some_and(|ticket| !ticket.is_cancelled())
    }

    /// False, having dropped the task, if the ticket is not active.
    pub fn schedule(
        &self,
        task: impl FnOnce(&mut Cx, &Ticket) -> JsResult<()> + Send + GcFree + 'static,
    ) -> bool {
        let Some(ticket) = self.upgrade().filter(|it| !it.is_cancelled()) else {
            return false;
        };
        let (host, task) = (Arc::clone(&ticket.host), DeferredTask(Box::new(task)));
        host.with_event_loop(|it| it.schedule_work(ticket, task))
    }

    /// Whether it was active.
    pub fn cancel(&self) -> bool {
        self.upgrade().is_some_and(|ticket| ticket.cancel())
    }
}

impl Cx {
    /// The work belongs to the realm of `target`.
    pub fn add_pending_work(
        &self,
        kind: WorkKind,
        target: Gc<JsObject>,
        dependencies: &[Gc<JsCell>],
    ) -> WeakTicket {
        let realm = target.realm().unwrap_or_else(|| self.global());
        let owner = (realm.hooks().current_script_execution_owner)(self.in_realm_shared(realm));
        let state = &self.services.deferred;
        let ticket = Arc::new(Ticket {
            kind,
            keeps_realm: kind == WorkKind::ImminentlyScheduled
                && !target.is::<JsFinalizationRegistry>(),
            is_cancelled: AtomicBool::new(false),
            host: Arc::clone(&state.host),
            realm: realm.address(),
            script_execution_owner: owner.address(),
            target: target.address(),
            dependencies: dependencies.iter().map(|it| it.address()).collect(),
        });
        let weak = WeakTicket(Arc::downgrade(&ticket));
        state.tickets.borrow_mut().push(weak.clone());
        state.host.with_event_loop(|it| it.add_pending_work(ticket));
        weak
    }
}
