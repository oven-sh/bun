use core::mem::offset_of;

use bun_engine_macros::cell;
use bun_engine_text::{PropertyName, names};

use super::initialize_at;
use super::reaction::Continuation;
use super::tagged_field::{TAG_SHIFT, TaggedField};
use crate::{
    CellKind, CellType, Cx, ErrorInstance, ErrorType, Field, Gc, GlobalObject, InternalMicrotask,
    InternalReaction, JsCell, JsObject, JsObjectInit, JsResult, Message, PromiseCapability,
    PromiseReaction, PromiseRejectionOperation, QueuedTask, RealmSlot, RealmWatchpoint, Shape,
    ShapeFlags, Storage, Thrown, TypeFlags, Value, Vm, species_constructor,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum PromiseStatus {
    Pending,
    Fulfilled,
    Rejected,
}

impl PromiseStatus {
    #[inline(always)]
    pub fn from_payload(payload: u8) -> PromiseStatus {
        let status = payload & JsPromise::STATUS_MASK as u8;
        // SAFETY: from zero to two.
        unsafe { core::mem::transmute(status.min(PromiseStatus::Rejected as u8)) }
    }
}

/// The only reaction to a pending promise usually fits in the promise.
///
/// | kind       | `payload`                                       | `slot`              |
/// | ---------- | ----------------------------------------------- | ------------------- |
/// | `None`     | the newest `PromiseReaction`                    | the result, if any  |
/// | `Internal` | the cell or else the async context              | the context         |
/// | a handler  | the promise that gets the result of the handler | the handler         |
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum InlineReactionKind {
    None,
    Internal,
    FulfillHandler,
    RejectHandler,
}

#[cell(name = "Promise", cell_type = Promise, export = "engine_class_Promise")]
pub struct JsPromise {
    base: JsObject,
    /// The tag has the flags.
    payload: TaggedField<JsCell>,
    pub(self) slot: Field<Option<Value>>,
}

/// What resolving a promise with an object comes to.
pub(super) enum Resolution {
    Settled(PromiseStatus, Value),
    /// With its `then`.
    Thenable(Value),
}

impl Resolution {
    /// Fails only if execution is terminated.
    #[inline(always)]
    pub(super) fn of(cx: &mut Cx, object: Gc<JsObject>) -> JsResult<Resolution> {
        if is_definitely_not_thenable(&object) {
            return Ok(Resolution::Settled(PromiseStatus::Fulfilled, object.into()));
        }
        Ok(match object.get(cx, names::then) {
            Ok(then) if then.is_callable() => Resolution::Thenable(then),
            Ok(_) => Resolution::Settled(PromiseStatus::Fulfilled, object.into()),
            Err(thrown) => Resolution::Settled(PromiseStatus::Rejected, cx.catch_value(thrown)?),
        })
    }
}

/// Whether the shapes tell that there is no `then` on the prototype chain.
#[inline(always)]
pub fn is_definitely_not_thenable(object: &JsObject) -> bool {
    let hides_properties = TypeFlags::OVERRIDES_GET_PROTOTYPE
        | TypeFlags::PROHIBITS_PROPERTY_CACHING
        | TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE
        | TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE;
    object.chain_direct().all(|object| {
        let shape = object.shape();
        !shape.has(ShapeFlags::HAS_THEN)
            && !shape.type_flags().intersects(hides_properties)
            && object.cell_type() != CellType::GlobalObject
    })
}

#[inline(always)]
fn callable_or_undefined(value: Value) -> Value {
    if value.is_callable() {
        value
    } else {
        Value::UNDEFINED
    }
}

impl JsPromise {
    pub const OFFSET_OF_PAYLOAD: usize = offset_of!(JsPromise, payload);
    pub const OFFSET_OF_FLAGS: usize = Self::OFFSET_OF_PAYLOAD + TAG_SHIFT as usize / 8;
    pub const OFFSET_OF_SLOT: usize = offset_of!(JsPromise, slot);

    pub const STATUS_MASK: u16 = 0b11;
    pub const IS_HANDLED: u16 = 1 << 2;
    /// `resolve`, `reject` and `fulfill` do nothing any more.
    pub const IS_RESOLVED: u16 = 1 << 3;
    pub const KIND_SHIFT: u32 = 4;
    pub const KIND_MASK: u16 = 0b11 << Self::KIND_SHIFT;
    pub const TASK_SHIFT: u32 = 6;
    pub const PAYLOAD_IS_ASYNC_CONTEXT: u16 = 1 << 14;
    const OUTLIVES_REACTION: u16 = Self::IS_HANDLED | Self::IS_RESOLVED;

    pub const fn payload_with_only(flags: u16) -> u64 {
        (flags as u64) << TAG_SHIFT
    }

    pub fn create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsPromise> {
        vm.allocate::<JsPromise>(JsPromiseInit {
            base: JsObjectInit::new(vm, shape),
            payload: TaggedField::new(0),
            slot: None,
        })
    }

    #[inline(always)]
    fn allocate_plain(cx: &Cx, flags: u16, slot: Option<Value>) -> Gc<JsPromise> {
        let init = Self::plain_init(cx.promise_shape(), flags, slot);
        let address = cx.allocate_cell_memory(size_of::<JsPromise>());
        // SAFETY: new, and of that size.
        unsafe { initialize_at(address, init) }
    }

    /// `shape` is the `promise_shape` of a realm.
    #[inline(always)]
    fn plain_init(shape: Gc<Shape>, flags: u16, slot: Option<Value>) -> JsPromiseInit {
        debug_assert!(shape.class().is(Self::CLASS) && !shape.max_offset().is_valid());
        JsPromiseInit {
            // SAFETY: it has neither properties nor elements.
            base: unsafe { JsObjectInit::with_storage(shape, Storage::NONE) },
            payload: TaggedField::new(flags),
            slot,
        }
    }

    /// `None` if it takes a call.
    #[inline(always)]
    fn try_allocate_quickly(
        vm: &Vm,
        global: &GlobalObject,
        flags: u16,
        slot: Option<Value>,
    ) -> Option<Gc<JsPromise>> {
        let shape = global.slot_if_initialized(RealmSlot::promise_shape)?;
        let address = vm.heap.cells.allocator_for(size_of::<Self>())?.try_bump()?;
        // SAFETY: what the slot has, and as above.
        unsafe {
            let init = Self::plain_init(shape.cast_unchecked(), flags, slot);
            Some(initialize_at(address, init))
        }
    }

    /// `new_promise`
    #[inline(always)]
    pub fn new(cx: &Cx) -> Gc<JsPromise> {
        Self::allocate_plain(cx, 0, None)
    }

    #[inline(always)]
    pub fn try_new_quickly(vm: &Vm, global: &GlobalObject) -> Option<Gc<JsPromise>> {
        Self::try_allocate_quickly(vm, global, 0, None)
    }

    #[inline(always)]
    pub(super) fn try_fulfilled_quickly(
        vm: &Vm,
        global: &GlobalObject,
        value: Value,
    ) -> Option<Gc<JsPromise>> {
        let flags = PromiseStatus::Fulfilled as u16 | Self::IS_RESOLVED;
        Self::try_allocate_quickly(vm, global, flags, Some(value))
    }

    /// `create_promise`
    pub fn for_new_target(cx: &mut Cx, new_target: Value) -> JsResult<Gc<JsPromise>> {
        let constructor = cx.promise_constructor();
        if new_target == constructor.into() {
            return Ok(Self::new(cx));
        }
        let shape =
            cx.shape_from_new_target(new_target, &constructor, GlobalObject::promise_shape)?;
        Ok(Self::create(cx, shape))
    }

    /// With `value` itself, even if it has a `then`.
    #[inline(always)]
    pub fn fulfilled(cx: &Cx, value: Value) -> Gc<JsPromise> {
        let flags = PromiseStatus::Fulfilled as u16 | Self::IS_RESOLVED;
        Self::allocate_plain(cx, flags, Some(value))
    }

    /// Always a new one. Fails only if execution is terminated.
    #[inline(always)]
    pub fn new_resolved(cx: &mut Cx, value: Value) -> JsResult<Gc<JsPromise>> {
        let Some(object) = value.as_object() else {
            return Ok(Self::fulfilled(cx, value));
        };
        let promise = Self::allocate_plain(cx, Self::IS_RESOLVED, None);
        promise.resolve_with_object(cx, object)?;
        Ok(promise)
    }

    /// PromiseResolve(%Promise%, value)
    #[inline]
    pub fn resolved(cx: &mut Cx, value: Value) -> JsResult<Gc<JsPromise>> {
        match value.downcast::<JsPromise>() {
            Some(promise) if promise.is_made_by(cx, cx.promise_constructor())? => Ok(promise),
            _ => Self::new_resolved(cx, value),
        }
    }

    pub fn rejected(cx: &Cx, reason: Value) -> Gc<JsPromise> {
        let promise = Self::new(cx);
        promise.reject(cx, reason);
        promise
    }

    pub fn rejected_with_caught(cx: &Cx, thrown: Thrown) -> JsResult<Gc<JsPromise>> {
        Ok(Self::rejected(cx, cx.catch_value(thrown)?))
    }

    #[inline(always)]
    pub fn global(&self) -> Gc<GlobalObject> {
        self.realm().expect("a promise belongs to a realm")
    }

    #[inline(always)]
    pub fn flags(&self) -> u16 {
        self.payload.tag()
    }

    #[inline(always)]
    pub fn status(&self) -> PromiseStatus {
        PromiseStatus::from_payload(self.flags() as u8)
    }

    #[inline(always)]
    pub fn is_pending(&self) -> bool {
        self.flags() & Self::STATUS_MASK == 0
    }

    #[inline(always)]
    pub fn is_handled(&self) -> bool {
        self.flags() & Self::IS_HANDLED != 0
    }

    #[inline(always)]
    pub fn mark_as_handled(&self) {
        self.payload.set_tag(self.flags() | Self::IS_HANDLED);
    }

    /// Whether this is the first time.
    #[inline(always)]
    pub fn mark_as_resolved(&self) -> bool {
        let flags = self.flags();
        self.payload.set_tag(flags | Self::IS_RESOLVED);
        flags & Self::IS_RESOLVED == 0
    }

    /// Undefined while it is pending.
    #[inline(always)]
    pub fn result(&self) -> Value {
        if self.is_pending() {
            return Value::UNDEFINED;
        }
        self.slot_value()
    }

    #[inline(always)]
    fn slot_value(&self) -> Value {
        self.slot().unwrap_or_default()
    }

    // The first of these calls is the one that counts.

    /// Fails only if execution is terminated.
    #[inline(always)]
    pub fn resolve(&self, cx: &mut Cx, value: Value) -> JsResult<()> {
        if !self.mark_as_resolved() {
            return Ok(());
        }
        self.resolve_promise(cx, value)
    }

    #[inline]
    pub fn fulfill(&self, vm: &Vm, value: Value) {
        if self.mark_as_resolved() {
            self.fulfill_promise(vm, value);
        }
    }

    #[inline]
    pub fn reject(&self, vm: &Vm, reason: Value) {
        if self.mark_as_resolved() {
            self.reject_promise(vm, reason);
        }
    }

    pub fn reject_as_handled(&self, vm: &Vm, reason: Value) {
        if self.mark_as_resolved() {
            self.mark_as_handled();
            self.reject_promise(vm, reason);
        }
    }

    pub fn reject_with_caught(&self, cx: &Cx, thrown: Thrown) -> JsResult<()> {
        self.reject(cx, cx.catch_value(thrown)?);
        Ok(())
    }

    /// Settles as `source` does, unobserved by scripts.
    pub fn pipe_from(&self, vm: &Vm, source: &JsPromise) {
        if self.mark_as_resolved() {
            let task = InternalMicrotask::PromiseFulfillWithoutHandler;
            let reaction =
                InternalReaction::new(task, Some(self.as_cell().into()), Value::UNDEFINED);
            source.react(vm, reaction);
        }
    }

    /// What `resolve` does with a promise while scripts have changed nothing, whatever they have changed.
    pub(crate) fn resolve_unobserved(&self, vm: &Vm, source: &JsPromise) {
        if self.mark_as_resolved() {
            let job = InternalMicrotask::PromiseResolveNativeThenable;
            let arguments = [source.into(), self.into(), Value::UNDEFINED, Value::TRUE];
            source.global().queue_microtask(vm, job, 0, arguments);
        }
    }

    // For the one that is known to have the say.

    /// What a promise resolve function does after its check. Fails only if execution is terminated.
    #[inline(always)]
    pub fn resolve_promise(&self, cx: &mut Cx, resolution: Value) -> JsResult<()> {
        match resolution.as_object() {
            Some(object) => self.resolve_with_object(cx, object),
            None => {
                self.fulfill_promise(cx, resolution);
                Ok(())
            }
        }
    }

    #[inline(never)]
    pub(super) fn resolve_with_object(&self, cx: &mut Cx, object: Gc<JsObject>) -> JsResult<()> {
        if let Some(promise) = object.downcast::<JsPromise>() {
            if promise.is_same(self) {
                let message = "Cannot resolve a promise with itself".into_string();
                let error = ErrorInstance::new(cx, ErrorType::TypeError, Some(message));
                self.reject_promise(cx, error.into());
                return Ok(());
            }
            if promise.has_pristine_then(cx) {
                let job = InternalMicrotask::PromiseResolveNativeThenable;
                let context = cx.current_async_context();
                let arguments = [promise.into(), self.into(), context, Value::FALSE];
                promise.global().queue_microtask(cx, job, 0, arguments);
                return Ok(());
            }
        }
        match Resolution::of(cx, object)? {
            Resolution::Settled(PromiseStatus::Rejected, error) => self.reject_promise(cx, error),
            Resolution::Settled(_, value) => self.fulfill_promise(cx, value),
            Resolution::Thenable(then) => {
                let job = InternalMicrotask::PromiseResolveThenable;
                let arguments = [object.into(), then, self.into(), cx.current_async_context()];
                cx.global().queue_microtask(cx, job, 0, arguments);
            }
        }
        Ok(())
    }

    /// FulfillPromise
    #[inline(always)]
    pub fn fulfill_promise(&self, vm: &Vm, value: Value) {
        if !self.try_fulfill_quickly(vm, value) {
            self.settle(vm, PromiseStatus::Fulfilled, value);
        }
    }

    /// RejectPromise
    #[inline]
    pub fn reject_promise(&self, vm: &Vm, reason: Value) {
        self.settle(vm, PromiseStatus::Rejected, reason);
    }

    /// False, having done nothing, if it takes a call.
    #[inline(always)]
    pub(super) fn try_fulfill_quickly(&self, vm: &Vm, value: Value) -> bool {
        if value.is_cell() && self.needs_write_barrier() {
            return false;
        }
        let (status, flags) = (PromiseStatus::Fulfilled, self.flags());
        if !self.is_pending_without_reactions() {
            // Once it has settled, it has none.
            let Some(global) = self.realm().filter(|_| flags & Self::KIND_MASK != 0) else {
                return false;
            };
            let task = self.task_of_inline_reaction(&global, status, value);
            if !task.try_queue_quickly(vm, &global) {
                return false;
            }
        }
        // SAFETY: none is needed.
        unsafe { self.slot.set_without_barrier(Some(value)) };
        (self.payload).clear(flags & Self::OUTLIVES_REACTION | status as u16);
        true
    }

    #[inline(never)]
    fn settle(&self, vm: &Vm, status: PromiseStatus, value: Value) {
        if !self.is_pending() {
            return;
        }
        let (global, flags, payload) = (self.global(), self.flags(), self.payload.cell());
        let task = (flags & Self::KIND_MASK != 0)
            .then(|| self.task_of_inline_reaction(&global, status, value));
        self.set_slot(Some(value));
        (self.payload).clear(flags & Self::OUTLIVES_REACTION | status as u16);
        if let Some(task) = task {
            return task.queue_or_divert(vm, &global);
        }
        if status == PromiseStatus::Rejected && flags & Self::IS_HANDLED == 0 {
            self.track_rejection(&global, PromiseRejectionOperation::Reject);
        }
        if let Some(newest) = payload {
            (newest.cast::<PromiseReaction>()).trigger(vm, &global, status, value);
        }
    }

    /// There is one.
    #[inline(always)]
    fn task_of_inline_reaction(
        &self,
        global: &GlobalObject,
        status: PromiseStatus,
        value: Value,
    ) -> QueuedTask {
        let (payload, slot) = (self.payload.cell(), self.slot_value());
        let kind = self.inline_reaction_kind();
        if kind == InlineReactionKind::Internal {
            let reaction = Self::internal_reaction(self.flags(), payload, slot);
            return reaction.to_task(global, status, value);
        }
        let is_handled = Self::status_handled_by(kind) == status;
        let handler = if is_handled { slot } else { Value::UNDEFINED };
        Continuation::new(payload.map_or_default(Value::from), Value::UNDEFINED)
            .to_task(global, status, value, handler)
    }

    /// HostPromiseRejectionTracker
    #[inline(never)]
    fn track_rejection(&self, global: &GlobalObject, operation: PromiseRejectionOperation) {
        // SAFETY: the callers have a `Vm` that is borrowed from the `Cx` in use, and this is a shared borrow too.
        let cx: &Cx = unsafe { Cx::from_global(global.into()) };
        (global.hooks().promise_rejection_tracker)(cx, self.into(), operation);
    }

    #[inline(always)]
    fn will_handle_rejection(&self, global: &GlobalObject) {
        if !self.is_handled() {
            self.track_rejection(global, PromiseRejectionOperation::Handle);
            self.mark_as_handled();
        }
    }

    // Reactions

    #[inline(always)]
    pub fn inline_reaction_kind(&self) -> InlineReactionKind {
        match (self.flags() & Self::KIND_MASK) >> Self::KIND_SHIFT {
            0 => InlineReactionKind::None,
            1 => InlineReactionKind::Internal,
            2 => InlineReactionKind::FulfillHandler,
            _ => InlineReactionKind::RejectHandler,
        }
    }

    #[inline(always)]
    fn status_handled_by(kind: InlineReactionKind) -> PromiseStatus {
        match kind {
            InlineReactionKind::FulfillHandler => PromiseStatus::Fulfilled,
            _ => PromiseStatus::Rejected,
        }
    }

    #[inline(always)]
    fn internal_reaction(flags: u16, payload: Option<Gc<JsCell>>, slot: Value) -> InternalReaction {
        let task = InternalMicrotask::from_bits((flags >> Self::TASK_SHIFT) as u8);
        if flags & Self::PAYLOAD_IS_ASYNC_CONTEXT == 0 {
            InternalReaction::new(task, payload, slot)
        } else {
            InternalReaction::new(task, None, slot)
                .in_async_context(payload.map_or_default(Value::from))
        }
    }

    #[inline(always)]
    fn is_pending_without_reactions(&self) -> bool {
        let ignored = u64::from(Self::OUTLIVES_REACTION) << TAG_SHIFT;
        self.payload.bits() & !ignored == 0
    }

    /// # Safety
    /// The write barrier follows, if it is needed.
    #[inline(always)]
    unsafe fn set_inline_reaction(&self, flags: u16, payload: Option<Gc<JsCell>>, slot: Value) {
        let flags = self.flags() | Self::IS_HANDLED | flags;
        // SAFETY: the caller's.
        unsafe {
            self.slot.set_without_barrier(Some(slot));
            self.payload.set_without_barrier(payload, flags);
        }
    }

    /// `make` gets the reactions so far.
    #[inline(always)]
    fn add_reaction(
        &self,
        vm: &Vm,
        make: impl FnOnce(Option<Gc<PromiseReaction>>) -> Gc<PromiseReaction>,
    ) {
        let (flags, payload) = (self.flags(), self.payload.cell());
        let older = match self.inline_reaction_kind() {
            InlineReactionKind::None => payload.map(Gc::cast),
            kind => Some(self.copy_inline_reaction(vm, kind)),
        };
        let newest = make(older);
        let flags = flags & Self::OUTLIVES_REACTION | Self::IS_HANDLED;
        // SAFETY: a field of this cell.
        unsafe { self.payload.set(self, Some(newest.cell()), flags) };
        self.set_slot(None);
    }

    #[inline(never)]
    fn copy_inline_reaction(&self, vm: &Vm, kind: InlineReactionKind) -> Gc<PromiseReaction> {
        let (payload, slot) = (self.payload.cell(), self.slot_value());
        if kind == InlineReactionKind::Internal {
            let reaction = Self::internal_reaction(self.flags(), payload, slot);
            return PromiseReaction::internal(vm, reaction, None);
        }
        let result = payload.map_or_default(Value::from);
        PromiseReaction::one_handler(vm, Self::status_handled_by(kind), slot, result, None)
    }

    /// Of a pending promise, newest first. See `PromiseReaction::describe`.
    pub fn reactions(&self) -> impl Iterator<Item = InternalReaction> + use<> {
        let payload = self.payload.cell();
        let (inline, newest) = match self.inline_reaction_kind() {
            InlineReactionKind::None => (None, payload.map(Gc::cast::<PromiseReaction>)),
            InlineReactionKind::Internal => {
                let reaction = Self::internal_reaction(self.flags(), payload, self.slot_value());
                (Some(reaction), None)
            }
            _ => {
                let task = InternalMicrotask::PromiseReaction;
                let reaction = InternalReaction::new(task, payload, Value::UNDEFINED);
                (Some(reaction), None)
            }
        };
        let others = core::iter::successors(newest, |it| it.next());
        inline.into_iter().chain(others.map(|it| it.describe()))
    }

    /// # Safety
    /// As for `set_inline_reaction`.
    #[inline(always)]
    unsafe fn try_react_inline(&self, reaction: InternalReaction) -> bool {
        if !self.is_pending_without_reactions() {
            return false;
        }
        let mut flags = (InlineReactionKind::Internal as u16) << Self::KIND_SHIFT
            | (reaction.task as u16) << Self::TASK_SHIFT;
        let payload = if reaction.async_context.is_undefined() {
            debug_assert!(reaction.cell.is_undefined() || reaction.cell.is_cell());
            reaction.cell
        } else if reaction.cell.is_undefined() && reaction.async_context.is_cell() {
            flags |= Self::PAYLOAD_IS_ASYNC_CONTEXT;
            reaction.async_context
        } else {
            return false;
        };
        // SAFETY: the caller's.
        unsafe { self.set_inline_reaction(flags, payload.as_cell(), reaction.context) };
        true
    }

    /// `global` is its realm. False, having done nothing, if it takes a call.
    #[inline(always)]
    fn try_react_quickly(
        &self,
        vm: &Vm,
        global: &GlobalObject,
        reaction: InternalReaction,
    ) -> bool {
        if self.status() == PromiseStatus::Fulfilled {
            let task = reaction.to_task(global, PromiseStatus::Fulfilled, self.slot_value());
            return task.try_queue_quickly(vm, global);
        }
        // SAFETY: none is needed.
        !self.needs_write_barrier() && unsafe { self.try_react_inline(reaction) }
    }

    /// PerformPromiseThen for a job of the engine.
    #[inline(always)]
    pub fn react(&self, vm: &Vm, it: InternalReaction) {
        if !self.try_react_quickly(vm, &self.global(), it) {
            self.react_slowly(vm, it.task, it.cell, it.context, it.async_context);
        }
    }

    #[inline(never)]
    fn react_slowly(
        &self,
        vm: &Vm,
        task: InternalMicrotask,
        cell: Value,
        context: Value,
        async_context: Value,
    ) {
        let reaction = InternalReaction {
            task,
            cell,
            context,
            async_context,
        };
        // SAFETY: it follows.
        if unsafe { self.try_react_inline(reaction) } {
            return self.write_barrier_for_cell();
        }
        let (global, status) = (self.global(), self.status());
        match status {
            PromiseStatus::Pending => {
                let make = |older| PromiseReaction::internal(vm, reaction, older);
                return self.add_reaction(vm, make);
            }
            PromiseStatus::Fulfilled => {}
            PromiseStatus::Rejected => self.will_handle_rejection(&global),
        }
        (reaction.to_task(&global, status, self.slot_value())).queue_or_divert(vm, &global);
    }

    /// PerformPromiseThen. `result` is a promise that nothing else resolves, the object of a `PromiseCapability`, or
    /// undefined.
    #[inline(never)]
    pub fn perform_then(&self, cx: &Cx, on_fulfilled: Value, on_rejected: Value, result: Value) {
        let then = Continuation::new(result, cx.current_async_context());
        self.add_handlers(cx, on_fulfilled, on_rejected, then);
    }

    /// The handlers get `context` as a second argument, unless it is undefined or null.
    pub fn perform_then_with_context(
        &self,
        cx: &Cx,
        on_fulfilled: Value,
        on_rejected: Value,
        result: Value,
        context: Value,
    ) {
        let then = Continuation::with_argument(cx, result, context);
        self.add_handlers(cx, on_fulfilled, on_rejected, then);
    }

    #[inline(always)]
    fn add_handlers(&self, cx: &Cx, on_fulfilled: Value, on_rejected: Value, then: Continuation) {
        let (status, handler) = match self.status() {
            PromiseStatus::Pending => {
                let on_fulfilled = callable_or_undefined(on_fulfilled);
                let on_rejected = callable_or_undefined(on_rejected);
                return self.add_handlers_for_later(cx, on_fulfilled, on_rejected, then);
            }
            PromiseStatus::Fulfilled => (PromiseStatus::Fulfilled, on_fulfilled),
            PromiseStatus::Rejected => {
                self.will_handle_rejection(&cx.global());
                (PromiseStatus::Rejected, on_rejected)
            }
        };
        let (global, handler) = (cx.global(), callable_or_undefined(handler));
        (then.to_task(&global, status, self.slot_value(), handler)).queue(cx, &global);
    }

    /// `perform_then` with a single function. False, having done nothing, if it takes a call.
    #[inline(always)]
    fn try_add_handler_quickly(
        &self,
        cx: &Cx,
        kind: InlineReactionKind,
        handler: Value,
        result: Gc<JsPromise>,
    ) -> bool {
        let async_context = cx.current_async_context();
        if self.status() == PromiseStatus::Fulfilled {
            let handler = match kind {
                InlineReactionKind::FulfillHandler => handler,
                _ => Value::UNDEFINED,
            };
            let (global, value) = (cx.global(), self.slot_value());
            return Continuation::new(result.into(), async_context)
                .to_task(&global, PromiseStatus::Fulfilled, value, handler)
                .try_queue_quickly(cx, &global);
        }
        if !self.is_pending_without_reactions()
            || !async_context.is_undefined()
            || self.needs_write_barrier()
        {
            return false;
        }
        let flags = (kind as u16) << Self::KIND_SHIFT;
        // SAFETY: none is needed.
        unsafe { self.set_inline_reaction(flags, Some(result.cell()), handler) };
        true
    }

    #[inline(always)]
    fn add_handlers_for_later(
        &self,
        vm: &Vm,
        on_fulfilled: Value,
        on_rejected: Value,
        then: Continuation,
    ) {
        let (kind, handler) = match (on_fulfilled.is_undefined(), on_rejected.is_undefined()) {
            (true, true) => return self.react(vm, then.without_handler()),
            (false, true) if !then.has_context() => {
                (InlineReactionKind::FulfillHandler, on_fulfilled)
            }
            (true, false) if !then.has_context() => {
                (InlineReactionKind::RejectHandler, on_rejected)
            }
            _ => {
                return self.add_reaction(vm, |older| {
                    PromiseReaction::handlers(vm, on_fulfilled, on_rejected, then, older)
                });
            }
        };
        if self.is_pending_without_reactions() && then.first.is::<JsPromise>() {
            let flags = (kind as u16) << Self::KIND_SHIFT;
            // SAFETY: it follows.
            unsafe { self.set_inline_reaction(flags, then.first.as_cell(), handler) };
            return self.write_barrier_for_cell();
        }
        self.add_reaction(vm, |older| {
            let handles = Self::status_handled_by(kind);
            PromiseReaction::one_handler(vm, handles, handler, then.first, older)
        });
    }

    // What scripts can change

    /// Whether it is an ordinary promise of that realm, in which the watchpoint is known to hold.
    #[inline(always)]
    pub fn is_plain_in(&self, global: &GlobalObject, which: RealmWatchpoint) -> bool {
        global.slot_if_initialized(RealmSlot::promise_shape) == Some(self.shape().cell())
            && global.watchpoints_unchecked(which).is_watched()
    }

    #[inline(never)]
    fn inherits_pristine(&self, vm: &Vm, which: RealmWatchpoint, name: PropertyName<'_>) -> bool {
        let (shape, global) = (self.shape(), self.global());
        global.holds(vm, which)
            && shape.prototype() == global.promise_prototype(vm).into()
            && shape.get(name).is_none()
    }

    /// Whether `then` is the original function of its realm, and finding it runs no code.
    #[inline(always)]
    pub fn has_pristine_then(&self, vm: &Vm) -> bool {
        let which = RealmWatchpoint::PromiseThen;
        self.is_plain_in(&self.global(), which) || self.inherits_pristine(vm, which, names::then)
    }

    /// The same for `constructor` and its `Symbol.species`.
    #[inline(always)]
    pub fn has_pristine_species(&self, vm: &Vm) -> bool {
        let which = RealmWatchpoint::PromiseSpecies;
        self.is_plain_in(&self.global(), which)
            || self.inherits_pristine(vm, which, names::constructor)
    }

    /// And it belongs to the current realm.
    #[inline(always)]
    pub fn has_pristine_then_in(&self, cx: &Cx) -> bool {
        let which = RealmWatchpoint::PromiseThen;
        self.is_plain_in(&cx.global(), which)
            || (self.global() == cx.global() && self.inherits_pristine(cx, which, names::then))
    }

    /// As above.
    #[inline(always)]
    pub fn has_pristine_species_in(&self, cx: &Cx) -> bool {
        let which = RealmWatchpoint::PromiseSpecies;
        self.is_plain_in(&cx.global(), which)
            || (self.global() == cx.global()
                && self.inherits_pristine(cx, which, names::constructor))
    }

    #[inline(always)]
    fn is_made_by(&self, cx: &mut Cx, constructor: Gc<JsObject>) -> JsResult<bool> {
        if self.has_pristine_species(cx) {
            return Ok(constructor == self.global().promise_constructor(cx));
        }
        Ok(self.get(cx, names::constructor)? == constructor.into())
    }

    /// SpeciesConstructor(object, %Promise%)
    pub fn species_constructor(cx: &mut Cx, object: &JsObject) -> JsResult<Gc<JsObject>> {
        if (object.downcast::<JsPromise>()).is_some_and(|it| it.has_pristine_species_in(cx)) {
            return Ok(cx.promise_constructor());
        }
        Ok(species_constructor(cx, object)?.unwrap_or_else(|| cx.promise_constructor()))
    }

    /// `Promise.prototype.then`
    #[inline(always)]
    pub fn then(
        &self,
        cx: &mut Cx,
        on_fulfilled: Value,
        on_rejected: Value,
    ) -> JsResult<Gc<JsObject>> {
        if !self.has_pristine_species_in(cx) {
            return self.then_with_species(cx, on_fulfilled, on_rejected);
        }
        let result = Self::new(cx);
        let (kind, handler, other) = if on_rejected.is_undefined() {
            (
                InlineReactionKind::FulfillHandler,
                on_fulfilled,
                on_rejected,
            )
        } else {
            (InlineReactionKind::RejectHandler, on_rejected, on_fulfilled)
        };
        let is_function = |cell: Gc<JsCell>| CellType::FUNCTIONS.contains(cell.cell_type());
        if !(other.is_undefined()
            && handler.as_cell().is_some_and(is_function)
            && self.try_add_handler_quickly(cx, kind, handler, result))
        {
            self.perform_then(cx, on_fulfilled, on_rejected, result.into());
        }
        Ok(result.upcast())
    }

    #[inline(never)]
    pub(super) fn then_with_species(
        &self,
        cx: &mut Cx,
        on_fulfilled: Value,
        on_rejected: Value,
    ) -> JsResult<Gc<JsObject>> {
        let constructor = Self::species_constructor(cx, self)?;
        let capability = PromiseCapability::new(cx, constructor.into())?;
        let object = capability.to_object(cx).into();
        self.perform_then(cx, on_fulfilled, on_rejected, object);
        Ok(capability.promise)
    }

    /// PromiseResolve
    #[inline]
    pub fn resolve_with_constructor(
        cx: &mut Cx,
        constructor: Gc<JsObject>,
        value: Value,
    ) -> JsResult<Gc<JsObject>> {
        if let Some(promise) = value.downcast::<JsPromise>()
            && promise.is_made_by(cx, constructor)?
        {
            return Ok(promise.upcast());
        }
        if constructor == cx.promise_constructor() {
            return Self::new_resolved(cx, value).map(Gc::upcast);
        }
        let capability = PromiseCapability::new(cx, constructor.into())?;
        cx.call(capability.resolve.into(), Value::UNDEFINED, &[value])?;
        Ok(capability.promise)
    }

    /// `Promise.reject`
    pub fn reject_with_constructor(
        cx: &mut Cx,
        constructor: Gc<JsObject>,
        reason: Value,
    ) -> JsResult<Gc<JsObject>> {
        if constructor == cx.promise_constructor() {
            return Ok(Self::rejected(cx, reason).upcast());
        }
        let capability = PromiseCapability::new(cx, constructor.into())?;
        cx.call(capability.reject.into(), Value::UNDEFINED, &[reason])?;
        Ok(capability.promise)
    }
}

impl InternalReaction {
    /// As if to a new promise that is resolved with `resolution`. Fails only if execution is terminated.
    #[inline(always)]
    pub fn resolve(self, cx: &mut Cx, resolution: Value) -> JsResult<()> {
        match resolution.as_object() {
            Some(object) => self.resolve_with_object(cx, object),
            None => {
                self.queue(cx, &cx.global(), PromiseStatus::Fulfilled, resolution);
                Ok(())
            }
        }
    }

    #[inline(never)]
    fn resolve_with_object(&self, cx: &mut Cx, object: Gc<JsObject>) -> JsResult<()> {
        let global = cx.global();
        if (object.downcast::<JsPromise>()).is_some_and(|it| it.has_pristine_then_in(cx)) {
            let job = InternalMicrotask::PromiseReactToNativeThenable;
            let arguments = [self.cell, object.into(), self.context, self.async_context];
            global.queue_microtask(cx, job, self.task as u8, arguments);
            return Ok(());
        }
        match Resolution::of(cx, object)? {
            Resolution::Settled(status, value) => self.queue(cx, &global, status, value),
            Resolution::Thenable(then) => {
                let job = InternalMicrotask::PromiseResolveThenable;
                let target = PromiseReaction::internal(cx, *self, None).into();
                let arguments = [object.into(), then, target, self.async_context];
                global.queue_microtask(cx, job, 0, arguments);
            }
        }
        Ok(())
    }

    /// Await, with this for what follows. If it throws, nothing has been arranged.
    #[inline(always)]
    pub fn await_value(self, cx: &mut Cx, value: Value) -> JsResult<()> {
        if self.try_await_quickly(cx, &cx.global(), value) {
            return Ok(());
        }
        let (task, cell) = (self.task, self.cell);
        Self::await_slowly(cx, value, task, cell, self.context, self.async_context)
    }

    /// The same in that realm. False, having done nothing, if it takes a call.
    #[inline(always)]
    pub(super) fn try_await_quickly(self, vm: &Vm, global: &GlobalObject, value: Value) -> bool {
        if let Some(object) = value.as_object() {
            if let Some(promise) = object.downcast::<JsPromise>() {
                return promise.is_plain_in(global, RealmWatchpoint::PromiseSpecies)
                    && promise.try_react_quickly(vm, global, self);
            }
            if !is_definitely_not_thenable(&object) {
                return false;
            }
        }
        (self.to_task(global, PromiseStatus::Fulfilled, value)).try_queue_quickly(vm, global)
    }

    #[inline(never)]
    fn await_slowly(
        cx: &mut Cx,
        value: Value,
        task: InternalMicrotask,
        cell: Value,
        context: Value,
        async_context: Value,
    ) -> JsResult<()> {
        let reaction = InternalReaction {
            task,
            cell,
            context,
            async_context,
        };
        if let Some(promise) = value.downcast::<JsPromise>()
            && (promise.has_pristine_species_in(cx)
                || promise.get(cx, names::constructor)? == cx.promise_constructor().into())
        {
            promise.react(cx, reaction);
            return Ok(());
        }
        reaction.resolve(cx, value)
    }
}

const _: () = assert!(size_of::<JsPromise>() == 32);
