//! Jumps out of constructs that have to clean up after themselves.

use bun_engine_syntax::ast::{BindingKind, ScopeFlags, ScopeId};
use bun_engine_syntax::{FunctionKind, Name};
use smallvec::SmallVec;

use super::{Dest, Generator, Suspension, This};
use crate::assembler::{Label, Site};
use crate::code::{CodeKind, HandlerKind};
use crate::operand::{CloseMode, DebugHook, Operand, Register, StaticError};

#[derive(Clone, Copy)]
pub(super) struct Target {
    label: Label,
    /// How many of `cleanups` are open there.
    depth: usize,
}

/// Where `break` and `continue` go.
#[derive(Clone, Copy, Default)]
pub(super) struct Targets {
    on_break: Option<Target>,
    on_continue: Option<Target>,
}

#[derive(Clone, Copy)]
pub(super) enum Exit {
    Jump(Target),
    Return(Operand),
}

/// What closes an iterator.
#[derive(Clone, Copy)]
pub(super) enum Closer {
    State(Register),
    Object(Operand),
}

#[derive(Clone, Copy)]
enum Duty {
    Finally {
        /// What gives `value` one on the ways that do not return.
        initialization: Option<Site>,
    },
    Close {
        closer: Closer,
        range: (u32, u32, u32),
        /// Outside of the handler that closes it.
        try_depth: u32,
        return_entry: Label,
    },
}

/// Code that runs on the way out. An exit enters the innermost, and each passes it on to the next.
pub(super) struct Cleanup {
    duty: Duty,
    entry: Label,
    /// Empty, an exception, `RETURN` or the number of a jump.
    completion: Register,
    /// What is to be returned.
    value: Register,
    returns: bool,
    /// Those for which it is the last.
    jumps: SmallVec<[(i32, Label); 2]>,
    /// The least `Target::depth` of those that enter.
    lowest_depth: usize,
}

impl Cleanup {
    fn is_entered_by_exits(&self) -> bool {
        self.returns || self.lowest_depth != usize::MAX
    }
}

const RETURN: i32 = 0;
const JUMPS_COMPARED: usize = 8;
/// An exit that leaves more goes through code that is outside of them.
const MOST_SUSPENDED_TRIES: u32 = 2;

/// The start of a handler that joins code which is reached in other ways too.
pub(super) struct DeferredHandler {
    handler: Label,
    exception: Register,
    value: Register,
    target: Label,
}

#[derive(Clone, Copy)]
struct Resource {
    value: Register,
    method: Register,
    is_async: bool,
}

pub(super) struct UsingScope {
    resources: SmallVec<[Resource; 2]>,
    declared: usize,
}

impl Generator<'_> {
    // Leaving

    fn jump_target(&self, label: Label) -> Option<Target> {
        let depth = self.b.cleanups.len();
        Some(Target { label, depth })
    }

    pub(super) fn open_label(&mut self, name: Name, on_break: Label) {
        self.state(name).mark = self.b.labels.len() as u32;
        let targets = Targets {
            on_break: self.jump_target(on_break),
            on_continue: None,
        };
        self.b.labels.push(targets);
    }

    /// Returns what `targets` has to be after the body.
    pub(super) fn enter_loop(&mut self, on_break: Label, on_continue: Label) -> Targets {
        let targets = Targets {
            on_break: self.jump_target(on_break),
            on_continue: self.jump_target(on_continue),
        };
        let first = core::mem::replace(&mut self.first_label_of_loop, usize::MAX);
        for label in self.b.labels.iter_mut().skip(first) {
            label.on_continue = targets.on_continue;
        }
        core::mem::replace(&mut self.targets, targets)
    }

    pub(super) fn enter_switch(&mut self, on_break: Label) -> Targets {
        let outer = self.targets;
        self.targets.on_break = self.jump_target(on_break);
        outer
    }

    fn targets_of(&mut self, label: Option<Name>) -> Option<Targets> {
        let Some(label) = label else {
            return Some(self.targets);
        };
        let index = self.state(label).mark;
        self.b.labels.get(index as usize).copied()
    }

    pub(super) fn break_target(&mut self, label: Option<Name>) -> Option<Target> {
        self.targets_of(label)?.on_break
    }

    pub(super) fn continue_target(&mut self, label: Option<Name>) -> Option<Target> {
        self.targets_of(label)?.on_continue
    }

    /// The label, if nothing has to be done on the way there.
    pub(super) fn plain_jump(&self, target: Target) -> Option<Label> {
        (target.depth == self.b.cleanups.len()).then_some(target.label)
    }

    /// Where the value of a `return` waits while `finally` code runs.
    pub(super) fn return_dest(&self) -> Dest {
        match self.b.cleanups.last() {
            Some(&Cleanup {
                duty: Duty::Finally { .. },
                value,
                ..
            }) => Dest::Prefer(value),
            _ => Dest::Any,
        }
    }

    pub(super) fn exit(&mut self, exit: Exit) {
        if !self.asm().is_reachable() {
            return;
        }
        let depth = match exit {
            Exit::Jump(target) => target.depth,
            Exit::Return(_) => 0,
        };
        let (mut open, mut suspended) = (self.b.cleanups.len(), None);
        if open > depth
            && let Duty::Close {
                closer,
                range,
                try_depth,
                ..
            } = self.b.cleanups[open - 1].duty
            && self.asm().try_depth() - try_depth <= MOST_SUSPENDED_TRIES
        {
            suspended = Some(self.asm().suspend_tries(try_depth));
            self.close_iterator(closer, range);
            open -= 1;
        }
        match exit {
            Exit::Jump(target) if open == depth => self.asm().jump(target.label),
            Exit::Jump(target) => {
                let number = self.number_jump(target);
                self.jump_through(open - 1, number, depth);
            }
            Exit::Return(value) if open == depth => self.return_past_tries(value),
            Exit::Return(value) => self.return_through(open - 1, value),
        }
        if let Some(tries) = suspended {
            self.asm().resume_tries(tries);
        }
    }

    fn number_jump(&mut self, target: Target) -> Operand {
        let jumps = &mut self.b.cleanups[target.depth].jumps;
        let mut recent = jumps.iter().rev().take(JUMPS_COMPARED);
        let number = match recent.find(|it| it.1 == target.label) {
            Some(&(number, _)) => number,
            None => {
                self.last_jump += 1;
                jumps.push((self.last_jump, target.label));
                self.last_jump
            }
        };
        self.int32(number)
    }

    fn jump_through(&mut self, index: usize, number: Operand, depth: usize) {
        let cleanup = &mut self.b.cleanups[index];
        cleanup.lowest_depth = cleanup.lowest_depth.min(depth);
        let (entry, completion) = (cleanup.entry, cleanup.completion);
        self.mov(completion, number);
        self.asm().jump(entry);
    }

    fn return_through(&mut self, index: usize, value: Operand) {
        let cleanup = &mut self.b.cleanups[index];
        cleanup.returns = true;
        let &mut Cleanup {
            duty,
            entry,
            completion,
            value: register,
            ..
        } = cleanup;
        self.mov(register, value);
        if let Duty::Close { return_entry, .. } = duty {
            return self.asm().jump(return_entry);
        }
        let number = self.int32(RETURN);
        self.asm().mov(completion, number);
        self.asm().jump(entry);
    }

    fn return_past_tries(&mut self, value: Operand) {
        let base = self.base_try_depth;
        if self.asm().try_depth() - base > MOST_SUSPENDED_TRIES {
            let epilogue = *(self.epilogue).get_or_insert_with(|| self.b.asm.label());
            self.mov(Register::local(self.body_top), value);
            return self.asm().jump(epilogue);
        }
        let suspended = self.asm().suspend_tries(base);
        if !self.only_sets_brand() {
            self.debug_hook(DebugHook::WillLeaveCallFrame, self.tree.end);
        }
        self.leave_frame(value);
        self.asm().resume_tries(suspended);
    }

    /// After the body.
    pub(super) fn emit_epilogue(&mut self) {
        if let Some(epilogue) = self.epilogue {
            self.asm().bind(epilogue);
            self.top = self.body_top;
            let value = self.temp();
            self.last_hook = None;
            self.return_past_tries(value.into());
        }
    }

    /// The jumps that have entered go on. Control gets past if none is under way.
    fn resume_jumps(&mut self, cleanup: &Cleanup, may_be_none: bool) {
        let passes_on = cleanup.lowest_depth < self.b.cleanups.len();
        for (left, &(number, label)) in cleanup.jumps.iter().enumerate().rev() {
            if left == 0 && !may_be_none && !passes_on {
                return self.asm().jump(label);
            }
            let number = self.int32(number);
            (self.asm()).jump_if_identical(cleanup.completion, number, label);
        }
        if passes_on {
            let (index, none) = (self.b.cleanups.len() - 1, self.asm().label());
            if may_be_none {
                self.asm().jump_if_not_number(cleanup.completion, none);
            }
            self.jump_through(index, cleanup.completion.into(), cleanup.lowest_depth);
            self.asm().bind(none);
        }
    }

    pub(super) fn leave_frame(&mut self, value: Operand) {
        match (self.suspension, self.generator) {
            (Suspension::Generator | Suspension::AsyncGenerator, Some(generator)) => {
                self.asm().generator_return(generator, value);
            }
            (Suspension::AsyncFunction, _) => {
                let generator = self.generator_or_empty();
                self.asm().async_return(generator, value);
            }
            _ if self.kind == CodeKind::Construct
                && self.function_kind != FunctionKind::NakedConstructor =>
            {
                self.leave_constructor(value);
            }
            _ => self.asm().ret(value),
        }
    }

    /// The last steps of [[Construct]].
    fn leave_constructor(&mut self, value: Operand) {
        let is_undefined = value == self.undefined();
        if !is_undefined && !matches!(self.this, This::Register(this) if value == this) {
            let not_object = self.asm().label();
            self.asm().jump_if_not_object(value, not_object);
            self.asm().ret(value);
            self.asm().bind(not_object);
            if self.function_kind == FunctionKind::DerivedConstructor {
                let (undefined, valid) = (self.undefined(), self.asm().label());
                self.asm().jump_if_identical(value, undefined, valid);
                self.throw_naming_function(StaticError::DerivedConstructorResult);
                self.asm().bind(valid);
            }
        }
        let this = self.this_value();
        self.asm().ret(this);
    }

    // Handlers

    pub(super) fn close_iterator_on_throw(&mut self, handler: Label, state: Register) {
        let (mark, exception, value) = (self.top, self.temp(), self.temp());
        self.asm().bind(handler);
        self.asm().catch(exception, value);
        self.asm().iterator_close(state, CloseMode::Throw);
        self.asm().rethrow(exception);
        self.top = mark;
    }

    pub(super) fn emit_deferred_handlers(&mut self) {
        for index in 0..self.b.deferred_handlers.len() {
            let DeferredHandler {
                handler,
                exception,
                value,
                target,
            } = self.b.deferred_handlers[index];
            self.asm().bind(handler);
            self.asm().catch(exception, value);
            self.asm().jump(target);
        }
    }

    fn open_cleanup(&mut self, duty: Duty, completion: Register, value: Register) -> Label {
        if self.b.cleanups.is_empty() {
            self.last_jump = RETURN;
        }
        let entry = self.asm().label();
        self.b.cleanups.push(Cleanup {
            duty,
            entry,
            completion,
            value,
            returns: false,
            jumps: SmallVec::new(),
            lowest_depth: usize::MAX,
        });
        entry
    }

    /// Opens a try, and returns its handler. From here to [`Generator::close_iterator_on_exits`], exits close the
    /// iterator.
    pub(super) fn guard_iterator(&mut self, closer: Closer, range: (u32, u32, u32)) -> Label {
        let duty = Duty::Close {
            closer,
            range,
            try_depth: self.asm().try_depth(),
            return_entry: self.asm().label(),
        };
        // What leaves has no more use for the registers of what is inside.
        let free = Register::local(self.top);
        self.open_cleanup(duty, free, free);
        let handler = self.asm().label();
        (self.asm()).push_try(handler, HandlerKind::SynthesizedFinally);
        handler
    }

    fn close_iterator(&mut self, closer: Closer, range: (u32, u32, u32)) {
        match closer {
            Closer::State(state) => {
                self.position(range.0, range.1, range.2);
                self.asm().iterator_close(state, CloseMode::Normal);
            }
            Closer::Object(iterator) => self.close_generic_iterator(iterator, range, false),
        }
    }

    /// After the try, where control does not get from above.
    pub(super) fn close_iterator_on_exits(&mut self) {
        let Some(cleanup) = self.b.cleanups.pop() else {
            return;
        };
        let Duty::Close {
            closer,
            range,
            return_entry,
            ..
        } = cleanup.duty
        else {
            return;
        };
        if !cleanup.is_entered_by_exits() {
            return;
        }
        let (mark, free) = (self.top, self.temp());
        debug_assert!(free == cleanup.value);
        if cleanup.returns {
            self.asm().bind(return_entry);
            self.close_iterator(closer, range);
            self.exit(Exit::Return(cleanup.value.into()));
        }
        if cleanup.lowest_depth != usize::MAX {
            self.asm().bind(cleanup.entry);
            self.close_iterator(closer, range);
            self.resume_jumps(&cleanup, false);
        }
        self.top = mark;
    }

    /// From here on, exits go through the code that follows [`Generator::enter_finally`]. Returns its label.
    pub(super) fn open_finally(&mut self) -> Label {
        let (completion, value) = (self.temp(), self.temp());
        let (empty, undefined) = (self.empty(), self.undefined());
        self.asm().mov(completion, empty);
        self.asm().mov(value, undefined);
        let initialization = self.asm().last().map(|(site, _)| site);
        self.tail_blockers += 1;
        self.open_cleanup(Duty::Finally { initialization }, completion, value)
    }

    /// `handler` catches what the protected code throws, and leaves the value in `thrown`.
    pub(super) fn enter_finally(&mut self, handler: Label, thrown: Register) -> Option<Cleanup> {
        let finally = self.b.cleanups.pop()?;
        self.tail_blockers -= 1;
        if let Duty::Finally {
            initialization: Some(site),
        } = finally.duty
            && !finally.returns
        {
            self.asm().remove(site);
        }
        if self.asm().is_referenced(handler) {
            if self.asm().is_reachable() || self.asm().is_referenced(finally.entry) {
                self.b.deferred_handlers.push(DeferredHandler {
                    handler,
                    exception: finally.completion,
                    value: thrown,
                    target: finally.entry,
                });
            } else {
                self.asm().bind(handler);
                self.asm().catch(finally.completion, thrown);
            }
        }
        self.asm().bind(finally.entry);
        Some(finally)
    }

    /// Goes on with what was under way when the code was entered.
    pub(super) fn leave_finally(&mut self, finally: &Cleanup) {
        if !finally.is_entered_by_exits() {
            return self.asm().rethrow_if_any(finally.completion);
        }
        let (empty, done) = (self.empty(), self.asm().label());
        self.asm()
            .jump_if_identical(finally.completion, empty, done);
        if finally.returns {
            let (number, next) = (self.int32(RETURN), self.asm().label());
            self.asm()
                .jump_if_not_identical(finally.completion, number, next);
            self.exit(Exit::Return(finally.value.into()));
            self.asm().bind(next);
        }
        self.resume_jumps(finally, true);
        self.asm().rethrow(finally.completion);
        self.asm().bind(done);
    }

    /// The end of code that runs under `handler`, where an error does not replace an exception that is under way.
    pub(super) fn leave_finally_keeping_exception(&mut self, finally: &Cleanup, handler: Label) {
        self.leave_finally(finally);
        if !self.asm().is_referenced(handler) {
            return;
        }
        let (mark, exception, value) = (self.top, self.temp(), self.temp());
        let (done, replaces) = (self.asm().label(), self.asm().label());
        self.asm().jump(done);
        self.asm().bind(handler);
        self.asm().catch(exception, value);
        let empty = self.empty();
        (self.asm()).jump_if_identical(finally.completion, empty, replaces);
        self.asm().jump_if_number(finally.completion, replaces);
        self.asm().rethrow(finally.completion);
        self.asm().bind(replaces);
        self.asm().rethrow(exception);
        self.asm().bind(done);
        self.top = mark;
    }

    // `using`

    /// Runs `body` and then disposes of the resources that the scope declares.
    pub(super) fn with_disposal(&mut self, scope: Option<ScopeId>, body: impl FnOnce(&mut Self)) {
        match scope {
            Some(scope) if self.ast[scope].flags.contains(ScopeFlags::HAS_USING) => {
                let (handler, kept) = (self.open_disposal(scope), self.b.kept_bindings.len());
                body(self);
                // What follows is reached from before their declarations too.
                self.b.kept_bindings.truncate(kept);
                self.close_disposal(handler);
            }
            _ => body(self),
        }
    }

    #[cold]
    fn open_disposal(&mut self, scope: ScopeId) -> (Label, Register, u32) {
        let mark = self.top;
        let (empty, undefined) = (self.empty(), self.undefined());
        let mut resources = SmallVec::new();
        for binding in self.ast.bindings(scope) {
            if let BindingKind::Using | BindingKind::AwaitUsing = binding.kind {
                let (value, method) = (self.temp(), self.temp());
                self.asm().mov(value, undefined);
                self.asm().mov(method, empty);
                resources.push(Resource {
                    value,
                    method,
                    is_async: binding.kind == BindingKind::AwaitUsing,
                });
            }
        }
        self.b.usings.push(UsingScope {
            resources,
            declared: 0,
        });
        let error = self.temp();
        self.asm().mov(error, empty);
        self.open_finally();
        let handler = self.asm().label();
        self.asm()
            .push_try(handler, HandlerKind::SynthesizedFinally);
        (handler, error, mark)
    }

    pub(super) fn add_disposable(&mut self, value: Operand, position: u32, is_async: bool) {
        let Some(using) = self.b.usings.last_mut() else {
            return;
        };
        let Some(&resource) = using.resources.get(using.declared) else {
            return;
        };
        using.declared += 1;
        self.asm().mov(resource.value, value);
        self.position_at(position);
        (self.asm()).get_dispose_method(resource.method, value, is_async);
    }

    /// DisposeResources. The method of a resource is empty if its declaration was not reached.
    #[cold]
    fn close_disposal(&mut self, (handler, error, mark): (Label, Register, u32)) {
        self.asm().pop_try();
        let (Some(using), Some(finally)) =
            (self.b.usings.pop(), self.enter_finally(handler, error))
        else {
            return;
        };
        let (empty, undefined) = (self.empty(), self.undefined());
        let (no, yes) = (self.boolean(false), self.boolean(true));
        let position = self.tree.end;
        let has_thrown = self.temp();
        self.asm().mov(has_thrown, no);
        // Undefined while no `await` is called for, true while one is due, false once one has taken place.
        let awaits = self.temp();
        if using.resources.iter().any(|resource| resource.is_async) {
            self.asm().mov(awaits, undefined);
        }
        let (result, caught) = (self.temp(), self.temp());
        let mut may_be_due = false;
        for resource in using.resources.iter().rev() {
            let (next, failed) = (self.asm().label(), self.asm().label());
            self.asm().jump_if_identical(resource.method, empty, next);
            if resource.is_async {
                let has_method = self.asm().label();
                (self.asm()).jump_if_not_identical(resource.method, undefined, has_method);
                self.asm().jump_if_identical(awaits, no, next);
                self.asm().mov(awaits, yes);
                self.asm().jump(next);
                self.asm().bind(has_method);
                may_be_due = true;
            } else {
                if may_be_due {
                    self.await_if_due(awaits, result, position);
                }
                self.asm()
                    .jump_if_identical(resource.method, undefined, next);
            }
            self.asm().push_try(failed, HandlerKind::SynthesizedCatch);
            self.position_at(position);
            self.call_method(result, resource.method, resource.value.into(), None);
            if resource.is_async {
                self.asm().mov(awaits, no);
                self.await_value(result, result.into(), position);
            }
            self.asm().pop_try();
            self.asm().jump(next);
            self.asm().bind(failed);
            self.asm().catch(result, caught);
            let is_first = self.asm().label();
            self.asm().jump_if_identical(error, empty, is_first);
            self.asm().new_suppressed_error(caught, caught, error);
            self.asm().bind(is_first);
            self.asm().mov(error, caught);
            self.asm().mov(has_thrown, yes);
            self.asm().bind(next);
        }
        if may_be_due {
            self.await_if_due(awaits, result, position);
        }
        let disposed = self.asm().label();
        self.asm().jump_if_false(has_thrown, disposed);
        self.asm().throw(error);
        self.asm().bind(disposed);
        self.leave_finally(&finally);
        self.top = mark;
    }

    fn await_if_due(&mut self, awaits: Register, scratch: Register, position: u32) {
        let (yes, undefined, done) = (self.boolean(true), self.undefined(), self.asm().label());
        self.asm().jump_if_not_identical(awaits, yes, done);
        self.await_value(scratch, undefined, position);
        self.asm().mov(awaits, undefined);
        self.asm().bind(done);
    }
}
