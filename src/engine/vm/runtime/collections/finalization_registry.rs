use core::cell::Cell;

use bun_engine_macros::cell;
use smallvec::SmallVec;

use crate::heap::{Scope, Survivors};
use crate::{
    Cx, FastHashMap, Gc, GcCell, JsCell, JsDestructibleObject, JsObject, JsObjectInit, JsResult,
    RootVec, Shape, Trace, Value, Visitor, Vm, WorkKind, root_vec,
};

#[derive(Clone, Copy)]
struct Live {
    target: usize,
    held: Value,
}

/// Targets and tokens are addresses of cells that are not kept alive.
#[derive(Default)]
struct Registrations {
    live: Vec<Live>,
    live_by_token: FastHashMap<usize, SmallVec<[Live; 1]>>,
    /// The held values of those whose target has died.
    dead: Vec<Value>,
    dead_by_token: FastHashMap<usize, SmallVec<[Value; 1]>>,
    /// Has each key of `dead_by_token`, and some that it has lost.
    tokens_of_dead: Vec<usize>,
    /// Those of `live` from here on are new since the last collection.
    first_young: usize,
    /// Those that something has been registered with since then.
    young_tokens: Vec<usize>,
}

// SAFETY: visits each held value that an earlier visit may not have seen. `reconcile` drops the addresses of the dead.
unsafe impl Trace for Registrations {
    fn trace(&self, visitor: &mut Visitor) {
        visitor.reconcile_current_cell_later();
        if visitor.scope() == Scope::Eden {
            let tokens = self.young_tokens.iter();
            let with_token = tokens.filter_map(|token| self.live_by_token.get(token));
            for live in self.live[self.first_young..]
                .iter()
                .chain(with_token.flatten())
            {
                live.held.trace(visitor);
            }
        } else {
            for live in self
                .live
                .iter()
                .chain(self.live_by_token.values().flatten())
            {
                live.held.trace(visitor);
            }
            for held in self
                .dead
                .iter()
                .chain(self.dead_by_token.values().flatten())
            {
                held.trace(visitor);
            }
        }
        visitor.report_extra_memory(self.allocation_size());
    }
}

impl Registrations {
    fn allocation_size(&self) -> usize {
        self.live.capacity() * size_of::<Live>()
            + self.dead.capacity() * size_of::<Value>()
            + self.live_by_token.allocation_size()
            + self.dead_by_token.allocation_size()
    }

    fn has_dead(&self) -> bool {
        !self.dead.is_empty() || !self.dead_by_token.is_empty()
    }

    fn take_dead(&mut self) -> Option<Value> {
        if let Some(held) = self.dead.pop() {
            return Some(held);
        }
        while let Some(token) = self.tokens_of_dead.last() {
            if let Some(list) = self.dead_by_token.get_mut(token) {
                let held = list.pop();
                if list.is_empty() {
                    self.dead_by_token.remove(token);
                }
                return held;
            }
            self.tokens_of_dead.pop();
        }
        None
    }

    fn reconcile(&mut self, survivors: &Survivors) {
        let is_live = |cell: usize| survivors.contains_address(cell);
        let mut tokens = core::mem::take(&mut self.young_tokens);
        if survivors.scope() == Scope::Full {
            self.first_young = 0;
            tokens.clear();
            tokens.extend(self.live_by_token.keys());
            let without_token = self.dead_by_token.extract_if(|&token, _| !is_live(token));
            self.dead.extend(without_token.flat_map(|(_, held)| held));
        }
        let died = (self.live).extract_if(self.first_young.., |it| !is_live(it.target));
        self.dead.extend(died.map(|it| it.held));
        for token in tokens {
            let Some(list) = self.live_by_token.get_mut(&token) else {
                continue;
            };
            if !is_live(token) {
                for live in list.drain(..) {
                    if is_live(live.target) {
                        self.live.push(live);
                    } else {
                        self.dead.push(live.held);
                    }
                }
            } else if !list.iter().all(|it| is_live(it.target)) {
                let dead = self.dead_by_token.entry(token).or_default();
                dead.extend(
                    list.iter()
                        .filter(|it| !is_live(it.target))
                        .map(|it| it.held),
                );
                list.retain(|it| is_live(it.target));
                self.tokens_of_dead.push(token);
            }
            if list.is_empty() {
                self.live_by_token.remove(&token);
            }
        }
        self.first_young = self.live.len();
        if survivors.scope() == Scope::Full {
            self.live.shrink_to(self.live.len() * 2);
            self.dead.shrink_to(self.dead.len() * 2);
            self.live_by_token.shrink_to(self.live_by_token.len() * 2);
            self.dead_by_token.shrink_to(self.dead_by_token.len() * 2);
        }
    }
}

#[cell(
    name = "FinalizationRegistry",
    reconcile_weak_references,
    export = "engine_class_FinalizationRegistry"
)]
pub struct JsFinalizationRegistry {
    base: JsDestructibleObject,
    callback: Gc<JsObject>,
    is_cleanup_scheduled: Cell<bool>,
    pub(self) registrations: GcCell<Registrations>,
}

#[derive(Clone, Copy)]
pub struct Registration {
    /// `None` once it has died.
    pub target: Option<Gc<JsCell>>,
    pub held_value: Value,
    pub unregister_token: Option<Gc<JsCell>>,
}

impl JsFinalizationRegistry {
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>, callback: Gc<JsObject>) -> Gc<Self> {
        vm.allocate::<JsFinalizationRegistry>(JsFinalizationRegistryInit {
            base: JsObjectInit::new(vm, shape),
            callback,
            is_cleanup_scheduled: Cell::new(false),
        })
    }

    pub fn callback(&self) -> Gc<JsObject> {
        self.callback
    }

    pub fn register(
        &self,
        cx: &mut Cx,
        target: Gc<JsCell>,
        held: Value,
        token: Option<Gc<JsCell>>,
    ) -> JsResult<()> {
        target.will_be_held_weakly();
        token.inspect(|token| token.will_be_held_weakly());
        let target = target.address();
        let live = Live { target, held };
        let mut registrations = self.registrations().borrow_mut(cx);
        let has_room = match token.map(Gc::address) {
            None => {
                let has_room = registrations.live.try_reserve(1).is_ok();
                if has_room {
                    registrations.live.push(live);
                }
                has_room
            }
            Some(token) => {
                let has_room = registrations.live_by_token.try_reserve(1).is_ok()
                    && registrations.young_tokens.try_reserve(1).is_ok();
                if has_room {
                    (registrations.live_by_token.entry(token).or_default()).push(live);
                    if registrations.young_tokens.last() != Some(&token) {
                        registrations.young_tokens.push(token);
                    }
                }
                has_room
            }
        };
        drop(registrations);
        if !has_room {
            return Err(cx.throw_out_of_memory());
        }
        cx.heap.did_allocate(size_of::<(usize, Live)>());
        Ok(())
    }

    /// Whether anything was registered with the token.
    pub fn unregister(&self, cx: &mut Cx, token: Gc<JsCell>) -> bool {
        let mut registrations = self.registrations().borrow_mut(cx);
        let had_live = registrations.live_by_token.remove(&token.address());
        let had_dead = registrations.dead_by_token.remove(&token.address());
        had_live.is_some() || had_dead.is_some()
    }

    pub fn snapshot(&self, vm: &Vm) -> RootVec<Registration> {
        let registrations = self.registrations().borrow(vm);
        // SAFETY: dropped before the cell is freed.
        let cell = |address: usize| Some(unsafe { Gc::from_address(address) });
        let live = |token| {
            move |it: &Live| Registration {
                target: cell(it.target),
                held_value: it.held,
                unregister_token: token,
            }
        };
        let dead = |token| {
            move |&held_value: &Value| Registration {
                target: None,
                held_value,
                unregister_token: token,
            }
        };
        let mut all = root_vec();
        all.extend(registrations.live.iter().map(live(None)));
        for (&token, list) in &registrations.live_by_token {
            all.extend(list.iter().map(live(cell(token))));
        }
        all.extend(registrations.dead.iter().map(dead(None)));
        for (&token, list) in &registrations.dead_by_token {
            all.extend(list.iter().map(dead(cell(token))));
        }
        all
    }

    /// CleanupFinalizationRegistry
    fn clean_up(&self, cx: &mut Cx) -> JsResult<()> {
        self.is_cleanup_scheduled.set(false);
        loop {
            let Some(held) = self.registrations().borrow_mut(cx).take_dead() else {
                return Ok(());
            };
            cx.call(self.callback.into(), Value::UNDEFINED, &[held])?;
        }
    }

    fn reconcile_weak_references(&self, survivors: &Survivors) {
        // SAFETY: no method allocates in the heap while it borrows them.
        let registrations = unsafe { self.registrations().get_mut_unchecked() };
        registrations.reconcile(survivors);
        if registrations.has_dead() && !self.is_cleanup_scheduled.replace(true) {
            let state = &survivors.vm().services.collections;
            state.to_clean_up.borrow_mut().push(self.address());
        }
    }

    /// HostEnqueueFinalizationRegistryCleanupJob
    pub(super) fn schedule_cleanup(&self) {
        let Some(realm) = self.realm() else { return };
        // SAFETY: a collection ends inside a call that has no less than a shared borrow.
        let cx: &Cx = unsafe { Cx::from_global(realm) };
        let ticket = cx.add_pending_work(WorkKind::ImminentlyScheduled, self.as_object(), &[]);
        ticket.schedule(|cx, ticket| match ticket.target(cx) {
            Some(registry) => registry.cast::<JsFinalizationRegistry>().clean_up(cx),
            None => Ok(()),
        });
    }
}
