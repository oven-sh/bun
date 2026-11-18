//! Loops over objects, and the points where code suspends.

use bun_engine_syntax::Name;
use bun_engine_syntax::ast::{
    BindingFlags, Enumeration, Expr, ExprId, ExprKind, ForTarget, ScopeId,
};
use bun_engine_text::symbols;
use smallvec::SmallVec;

use super::control::{Closer, Exit};
use super::scope::Place;
use super::{Dest, Generator, Suspension};
use crate::assembler::Site;
use crate::code::{CoverageKind, HandlerKind};
use crate::instruction::Opcode;
use crate::operand::{
    CloseMode, DebugHook, Operand, Register, ResumeMode, ScopeIndex, StaticError, SuspendKind,
};

/// A `for`-`in` loop whose variable is a register.
pub(super) struct ForIn {
    key: Register,
    subject: Option<Register>,
    state: Register,
    /// The instructions that count on the variable being what the loop made it.
    uses: SmallVec<[Site; 4]>,
}

const LOOPS_SEARCHED: usize = 8;

impl Generator<'_> {
    // What the body of a `for`-`in` loop does with its variable

    pub(super) fn for_in_state(
        &self,
        key: Register,
        subject: Option<Register>,
    ) -> Option<Register> {
        let mut innermost = self.b.for_ins.iter().rev().take(LOOPS_SEARCHED);
        let for_in = innermost.find(|it| it.key == key)?;
        (subject.is_none() || subject == for_in.subject).then_some(for_in.state)
    }

    /// The next instruction is one.
    pub(super) fn note_for_in_use(&mut self, key: Register) {
        if self.asm().is_reachable() {
            let site = self.asm().here();
            if let Some(for_in) = self.b.for_ins.iter_mut().rfind(|it| it.key == key) {
                for_in.uses.push(site);
            }
        }
    }

    #[inline]
    fn use_for_in(&mut self, key: Operand) -> Option<(Register, Register)> {
        if self.b.for_ins.is_empty() {
            return None;
        }
        let key = key.as_register()?;
        let state = self.for_in_state(key, None)?;
        self.note_for_in_use(key);
        Some((key, state))
    }

    pub(super) fn get_by_val(&mut self, dst: Register, base: Operand, key: Operand) {
        match self.use_for_in(key) {
            Some((key, state)) => self.asm().for_in_get(dst, base, key, state),
            None => self.asm().get_by_val(dst, base, key),
        }
    }

    pub(super) fn put_by_val(&mut self, base: Operand, key: Operand, value: Operand) {
        let strict = self.is_strict;
        match self.use_for_in(key) {
            Some((key, state)) => self.asm().for_in_put(base, key, state, value, strict),
            None => self.asm().put_by_val(base, key, value, strict),
        }
    }

    pub(super) fn in_by_val(&mut self, dst: Register, base: Operand, key: Operand) {
        match self.use_for_in(key) {
            Some((key, state)) => self.asm().for_in_has(dst, base, key, state),
            None => self.asm().in_by_val(dst, base, key),
        }
    }

    #[cold]
    fn generalize_for_in_uses(&mut self, for_in: &ForIn) {
        use crate::operand::Field;
        let never = self.empty().word();
        let asm = self.asm();
        for &site in &for_in.uses {
            let word = |index| asm.operand(site, index);
            match asm.opcode(site) {
                Opcode::ForInGet => {
                    let words = [word(0), word(1), word(2)];
                    asm.replace(site, Opcode::GetByVal, &words);
                }
                Opcode::ForInHas => {
                    let words = [word(0), word(1), word(2)];
                    asm.replace(site, Opcode::InByVal, &words);
                }
                Opcode::ForInPut => {
                    let words = [word(0), word(1), word(3), word(4)];
                    asm.replace(site, Opcode::PutByVal, &words);
                }
                _ => asm.set_operand(site, 1, never),
            }
        }
    }

    // The head of a loop

    fn is_call(&self, target: ForTarget) -> Option<ExprId> {
        match target {
            ForTarget::Expression(id) if matches!(self.ast[id].kind, ExprKind::Call { .. }) => {
                Some(id)
            }
            _ => None,
        }
    }

    /// The register that the values can go straight into.
    fn loop_register(&mut self, target: ForTarget) -> Option<Register> {
        match target {
            ForTarget::Pattern { pattern, .. } => self.resolve_pattern_register(pattern),
            ForTarget::Expression(id) => match self.ast[id].kind {
                ExprKind::Identifier(name) | ExprKind::Initialize { name, .. } => {
                    self.resolve(name, self.ast[id].start).writable_register()
                }
                _ => None,
            },
        }
    }

    fn pause_at_target(&mut self, target: ForTarget) {
        let start = match target {
            ForTarget::Pattern { start, .. } => start,
            ForTarget::Expression(id) => self.ast[id].start,
        };
        self.debug_hook(DebugHook::WillExecuteStatement, start);
    }

    fn assign_loop_target(&mut self, it: &Enumeration, value: Register) {
        let mark = self.top;
        match it.target {
            ForTarget::Pattern { pattern, .. } => self.bind_pattern(pattern, value.into()),
            ForTarget::Expression(id) => {
                let node = &self.ast[id];
                let head = (it.divot, it.target_start, it.end);
                let (reference, range) = match node.kind {
                    ExprKind::Identifier(name) | ExprKind::Initialize { name, .. } => {
                        (self.variable_reference(name, node.start, head), head)
                    }
                    ExprKind::Dot { divot, end, .. }
                    | ExprKind::PrivateDot { divot, end, .. }
                    | ExprKind::Index { divot, end, .. } => {
                        (self.reference(id, head), (divot, node.start, end))
                    }
                    _ => return,
                };
                self.store_reference(&reference, value.into(), range);
            }
        }
        self.top = mark;
    }

    fn enter_loop_scope(&mut self, scope: Option<ScopeId>) -> Option<(ScopeIndex, Register)> {
        let parent = self.scope;
        Some((self.enter_block_scope(scope?)?, parent))
    }

    /// Each turn has bindings of its own.
    fn renew_loop_scope(&mut self, it: &Enumeration, created: Option<(ScopeIndex, Register)>) {
        for binding in it.scope.map_or(&[][..], |scope| self.ast.bindings(scope)) {
            if binding.flags.contains(BindingFlags::USED_EARLY)
                && let Place::Register(register) = self.resolve_declared(binding.name)
            {
                let empty = self.empty();
                self.asm().mov(register, empty);
            }
        }
        if let Some((index, parent)) = created {
            let scope = self.scope;
            self.asm().create_scope(scope, parent, index);
        }
    }

    fn leave_loop_scope(&mut self, scope: Option<ScopeId>) {
        if scope.is_some() {
            self.close_scope();
        }
    }

    fn cover_target(&mut self, it: &Enumeration) {
        if self.covers {
            let (start, end) = (it.target_start as i32, it.divot as i32);
            self.emit_cover(start, end, CoverageKind::LoopHeader);
        }
    }

    fn loop_body(&mut self, it: &Enumeration, completion: Option<Register>) {
        let body = &self.ast[it.body];
        self.cover(body.start, body.end);
        self.tail_blockers += 1;
        self.statement(it.body, completion);
        self.tail_blockers -= 1;
    }

    #[inline(never)]
    pub(super) fn for_in(&mut self, it: &Enumeration, completion: Option<Register>) {
        let range = (it.divot, it.target_start, it.end);
        if let Some(call) = self.is_call(it.target) {
            self.assign_to_call(call, range, StaticError::ForInTargetIsCall);
            return;
        }
        let created = self.enter_loop_scope(it.scope);
        let mut has_initializer = false;
        if let ForTarget::Expression(id) = it.target
            && let ExprKind::Initialize { .. } = self.ast[id].kind
        {
            self.effect(id);
            has_initializer = true;
        }
        let base = self.expr_to_temp(it.subject);
        let state = self.temps(3);
        let variable = self.loop_register(it.target);
        let key = variable.unwrap_or_else(|| self.temp());
        let (next, done) = (self.asm().label(), self.asm().label());
        self.asm().for_in_open(state, base, done);
        self.asm().bind_loop_head(next);
        self.asm().loop_hint();
        self.pause_at_target(it.target);
        self.renew_loop_scope(it, created);
        self.asm().for_in_next(key, state, base, done);
        if !has_initializer {
            self.cover_target(it);
        }
        if variable.is_none() {
            self.assign_loop_target(it, key);
        }
        let body = self.asm().here();
        if variable.is_some() {
            if self.b.for_ins.is_empty() {
                self.asm().track_writes();
            }
            let subject = self.register_of(it.subject);
            self.b.for_ins.push(ForIn {
                key,
                subject,
                state,
                uses: SmallVec::new(),
            });
        }
        let outer = self.enter_loop(done, next);
        self.loop_body(it, completion);
        self.targets = outer;
        if variable.is_some()
            && let Some(for_in) = self.b.for_ins.pop()
            && !for_in.uses.is_empty()
            && self.asm().has_written(key, body)
        {
            self.generalize_for_in_uses(&for_in);
        }
        self.asm().jump(next);
        self.asm().bind(done);
        self.leave_loop_scope(it.scope);
    }

    fn get_symbol_method(&mut self, dst: Register, base: Operand, is_async: bool) {
        let name = self.symbol_identifier(if is_async {
            symbols::asyncIterator
        } else {
            symbols::iterator
        });
        self.asm().get_by_id(dst, base, name);
    }

    pub(super) fn throw_unless_result(&mut self, value: Register) {
        (self.asm()).throw_if_not_object(value, StaticError::IteratorResultNotObject);
    }

    /// What is left of GetIteratorFromMethod once the method is known to be there.
    fn open_generic_iterator(&mut self, state: Register, method: Register, iterable: Operand) {
        self.call_method(state, method, iterable, None);
        self.throw_unless_result(state);
        self.get_by_id(state.nth(1), state.into(), Name::NEXT);
    }

    #[inline(never)]
    pub(super) fn for_of(&mut self, it: &Enumeration, completion: Option<Register>) {
        let (divot, start, end) = (it.divot, it.target_start, it.end);
        if let Some(call) = self.is_call(it.target) {
            self.assign_to_call(call, (divot, start, end), StaticError::ForOfTargetIsCall);
            return;
        }
        let created = self.enter_loop_scope(it.scope);
        let state = self.temps(3);
        let variable = self.loop_register(it.target);
        let value = variable.unwrap_or_else(|| self.temp());
        let mark = self.top;
        let known = self.iterable_with_method(it.subject);
        let iterable = self.expr(known.map_or(it.subject, |it| it.0), Dest::Any);
        let (method, next) = (self.temp(), self.asm().label());
        self.position(divot, start, end);
        match known {
            Some((_, known)) => _ = self.expr(known, Dest::Temp(method)),
            None => self.get_symbol_method(method, iterable, false),
        }
        self.debug_hook(DebugHook::WillExecuteExpression, start);
        self.position(divot, start, end);
        let opened = self.asm().label();
        self.asm().iterator_open(state, iterable, method, opened);
        self.open_generic_iterator(state, method, iterable);
        self.asm().bind(opened);
        self.top = mark;

        let (generic, body) = (self.asm().label(), self.asm().label());
        let (on_break, done) = (self.asm().label(), self.asm().label());
        self.asm().bind_loop_head(next);
        self.asm().loop_hint();
        self.pause_at_target(it.target);
        self.renew_loop_scope(it, created);
        self.debug_hook(DebugHook::WillExecuteExpression, start);
        self.position(divot, start, end);
        self.asm().iterator_next(value, state, done, generic);
        self.asm().bind_loop_head(body);

        let handler = self.guard_iterator(Closer::State(state), (divot, start, end));
        let outer = self.enter_loop(on_break, next);
        self.with_disposal(it.scope, |generator| {
            generator.cover_target(it);
            if variable.is_none() {
                generator.assign_loop_target(it, value);
            }
            generator.loop_body(it, completion);
        });
        self.targets = outer;
        self.asm().jump(next);
        self.asm().pop_try();
        self.close_iterator_on_exits();

        self.asm().bind(generic);
        let (result, is_done) = (self.temp(), self.temp());
        self.position(divot, start, end);
        self.call_method(result, state.nth(1), state.into(), None);
        self.throw_unless_result(result);
        self.get_by_id(is_done, result.into(), Name::DONE);
        self.asm().jump_if_true(is_done, done);
        self.get_by_id(value, result.into(), Name::VALUE);
        self.asm().jump(body);

        self.close_iterator_on_throw(handler, state);
        self.asm().bind(on_break);
        self.position(divot, start, end);
        self.asm().iterator_close(state, CloseMode::Normal);
        self.asm().bind(done);
        self.leave_loop_scope(it.scope);
    }

    // Asynchronous iteration

    fn open_async_iterator(&mut self, state: Register, iterable: Operand, range: (u32, u32, u32)) {
        let (mark, method, opened) = (self.top, self.temp(), self.asm().label());
        self.position(range.0, range.1, range.2);
        self.get_symbol_method(method, iterable, true);
        self.debug_hook(DebugHook::WillExecuteExpression, range.1);
        self.position(range.0, range.1, range.2);
        (self.asm()).async_iterator_open(state, iterable, method, opened);
        self.open_generic_iterator(state, method, iterable);
        self.asm().bind(opened);
        self.top = mark;
    }

    fn call_async_next(
        &mut self,
        dst: Register,
        state: Register,
        argument: Option<Operand>,
        range: (u32, u32, u32),
    ) {
        let generator = self.generator_or_empty();
        let (generator, queued) = (self.in_register(generator), self.asm().label());
        let value = argument.unwrap_or_else(|| self.empty());
        self.position(range.0, range.1, range.2);
        (self.asm()).async_iterator_next(dst, state, generator, value, queued);
        self.call_method(dst, state.nth(1), state.into(), argument);
        self.asm().bind(queued);
    }

    /// IteratorClose or AsyncIteratorClose of an object, for a completion that is no exception.
    pub(super) fn close_generic_iterator(
        &mut self,
        iterator: Operand,
        range: (u32, u32, u32),
        is_async: bool,
    ) {
        let (mark, method, done) = (self.top, self.temp(), self.asm().label());
        self.get_by_id(method, iterator, Name::RETURN);
        self.asm().jump_if_nullish(method, done);
        self.position(range.0, range.1, range.2);
        self.call_method(method, method, iterator, None);
        if is_async {
            self.await_value(method, method.into(), range.0);
        }
        self.throw_unless_result(method);
        self.asm().bind(done);
        self.top = mark;
    }

    #[inline(never)]
    pub(super) fn for_await(&mut self, it: &Enumeration, completion: Option<Register>) {
        let range = (it.divot, it.target_start, it.end);
        if let Some(call) = self.is_call(it.target) {
            self.assign_to_call(call, range, StaticError::ForOfTargetIsCall);
            return;
        }
        let created = self.enter_loop_scope(it.scope);
        let (state, value) = (self.temps(2), self.temp());
        let iterable = self.expr(it.subject, Dest::Prefer(value));
        self.open_async_iterator(state, iterable, range);
        self.open_finally();

        let (next, on_break, done) = (self.asm().label(), self.asm().label(), self.asm().label());
        self.asm().bind_loop_head(next);
        self.asm().loop_hint();
        self.pause_at_target(it.target);
        self.renew_loop_scope(it, created);
        self.call_async_next(value, state, None, range);
        self.await_value(value, value.into(), range.0);
        self.throw_unless_result(value);
        let scratch = self.temp();
        self.get_by_id(scratch, value.into(), Name::DONE);
        self.asm().jump_if_true(scratch, done);
        self.get_by_id(value, value.into(), Name::VALUE);

        let handler = self.asm().label();
        self.asm()
            .push_try(handler, HandlerKind::SynthesizedFinally);
        let outer = self.enter_loop(on_break, next);
        self.with_disposal(it.scope, |generator| {
            generator.cover_target(it);
            generator.assign_loop_target(it, value);
            generator.loop_body(it, completion);
        });
        self.targets = outer;
        self.asm().jump(next);
        self.asm().pop_try();

        if let Some(finally) = self.enter_finally(handler, scratch) {
            let failed = self.asm().label();
            self.asm().push_try(failed, HandlerKind::SynthesizedCatch);
            self.close_generic_iterator(state.into(), range, true);
            self.asm().pop_try();
            self.leave_finally_keeping_exception(&finally, failed);
        }
        self.asm().jump(done);
        self.asm().bind(on_break);
        self.close_generic_iterator(state.into(), range, true);
        self.asm().bind(done);
        self.leave_loop_scope(it.scope);
    }

    // Suspension

    pub(super) fn suspend(&mut self, value: Operand, kind: SuspendKind) {
        self.suspensions += 1;
        self.last_hook = None;
        let Some(generator) = self.generator else {
            return;
        };
        let hooks = match kind {
            _ if !self.debugs => None,
            SuspendKind::Start => None,
            SuspendKind::Await => Some((DebugHook::WillAwait, DebugHook::DidAwait)),
            _ => Some((DebugHook::WillYield, DebugHook::DidYield)),
        };
        if let Some((will_suspend, _)) = hooks {
            self.asm().debug_await(will_suspend, generator);
        }
        let point = self.asm().add_suspend_point(kind);
        self.keep_while_suspended();
        if self.suspension == Suspension::AsyncFunction {
            self.asm().r#await(generator, value, point);
        } else {
            self.asm().suspend(generator, value, kind, point);
        }
        self.asm().resume(generator, point);
        if self.debugs {
            self.keep_scopes();
        }
        if let Some((_, did_resume)) = hooks {
            self.asm().debug_await(did_resume, generator);
        }
    }

    /// What a program can expect to stay alive although it is not read again.
    fn keep_while_suspended(&mut self) {
        let inputs = self.b.kept_inputs.iter().map(|it| it.register);
        let bindings = self.b.kept_bindings.iter().map(|it| it.1);
        let kept = core::iter::once(self.scope).chain(inputs).chain(bindings);
        self.b.asm.keep_while_suspended(kept);
    }

    #[inline(never)]
    pub(super) fn await_value(&mut self, dst: Register, value: Operand, position: u32) {
        if self.debugs {
            self.position_at(position);
        }
        self.suspend(value, SuspendKind::Await);
        self.asm().resume_after_await(dst);
    }

    pub(super) fn resume_or_return(&mut self, received: Register) {
        let normal = self.asm().label();
        self.asm().resume_after_yield(received, normal);
        self.exit(Exit::Return(received.into()));
        self.asm().bind(normal);
    }

    #[inline(never)]
    pub(super) fn yield_value(&mut self, argument: Option<ExprId>, dst: Dest) -> Operand {
        let received = self.temp_dst(dst);
        let value = match argument {
            Some(argument) => self.expr(argument, Dest::Prefer(received)),
            None => self.undefined(),
        };
        self.suspend(value, SuspendKind::Yield);
        self.resume_or_return(received);
        self.deliver(dst, received)
    }

    #[inline(never)]
    pub(super) fn yield_delegate(&mut self, node: &Expr, dst: Dest) -> Operand {
        let ExprKind::YieldDelegate {
            argument,
            divot,
            end,
        } = node.kind
        else {
            return self.undefined();
        };
        let range = (divot, node.start, end);
        let is_async = self.suspension == Suspension::AsyncGenerator;
        let value = self.temp_dst(dst);
        let (state, scratch) = (self.temps(2), self.temp());
        let iterable = self.expr(argument, Dest::Prefer(value));
        if is_async {
            self.open_async_iterator(state, iterable, range);
        } else {
            self.position(divot, node.start, end);
            self.get_symbol_method(scratch, iterable, false);
            self.open_generic_iterator(state, scratch, iterable);
        }
        let iterator = Operand::from(state);
        let undefined = self.undefined();
        self.asm().mov(value, undefined);

        let [next, examine, pass_on, on_throw, on_return, done] =
            core::array::from_fn(|_| self.asm().label());
        self.asm().bind_loop_head(next);
        self.asm().loop_hint();
        if is_async {
            self.call_async_next(value, state, Some(value.into()), range);
        } else {
            self.position(divot, node.start, end);
            self.call_method(value, state.nth(1), iterator, Some(value.into()));
        }
        self.asm().bind_loop_head(examine);
        self.examine_result(value, scratch, divot, is_async);
        self.asm().jump_if_true(scratch, done);
        self.asm().bind_loop_head(pass_on);
        if is_async {
            self.get_by_id(value, value.into(), Name::VALUE);
        }
        self.suspend(value.into(), SuspendKind::Delegate);
        self.asm().resume_after_delegate(value, scratch);
        let normal = self.int32(ResumeMode::Normal as i32);
        self.asm().jump_if_identical(scratch, normal, next);
        let returns = self.int32(ResumeMode::Return as i32);
        self.asm().jump_if_identical(scratch, returns, on_return);

        self.get_by_id(scratch, iterator, Name::THROW);
        self.asm().jump_if_not_nullish(scratch, on_throw);
        self.close_generic_iterator(iterator, range, is_async);
        self.throw_static(StaticError::DelegateHasNoThrow);
        self.asm().bind(on_throw);
        self.position(divot, node.start, end);
        self.call_method(value, scratch, iterator, Some(value.into()));
        self.asm().jump(examine);

        self.asm().bind(on_return);
        let (has_method, leave) = (self.asm().label(), self.asm().label());
        self.get_by_id(scratch, iterator, Name::RETURN);
        if is_async {
            self.asm().jump_if_not_nullish(scratch, has_method);
            self.await_value(value, value.into(), divot);
            self.asm().jump(leave);
        } else {
            self.asm().jump_if_nullish(scratch, leave);
        }
        self.asm().bind(has_method);
        self.position(divot, node.start, end);
        self.call_method(value, scratch, iterator, Some(value.into()));
        self.examine_result(value, scratch, divot, is_async);
        self.asm().jump_if_false(scratch, pass_on);
        self.get_by_id(value, value.into(), Name::VALUE);
        self.asm().bind(leave);
        self.exit(Exit::Return(value.into()));

        self.asm().bind(done);
        self.get_by_id(value, value.into(), Name::VALUE);
        self.deliver(dst, value)
    }

    fn examine_result(&mut self, result: Register, done: Register, divot: u32, is_async: bool) {
        if is_async {
            self.await_value(result, result.into(), divot);
        }
        self.throw_unless_result(result);
        self.get_by_id(done, result.into(), Name::DONE);
    }
}
