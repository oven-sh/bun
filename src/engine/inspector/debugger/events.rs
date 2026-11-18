//! What running code reports.

use core::ops::RangeInclusive;
use std::rc::{Rc, Weak};

use bun_engine_bytecode::{DebugHook, Instructions, Opcode};
use bun_engine_platform::clock::monotonic_seconds;
use bun_engine_text::StringRef;
use bun_engine_vm::{
    CallFrame, CellType, CodeBlock, CompileError, CompileErrorKind, Coroutine, Cx, ErrorInstance,
    Exception, FrameKind, FunctionExecutable, Gc, InternalFunction, InternalMicrotask, JsCell,
    JsFunction, MicrotaskEvent, SourceProvider, StackVisitor, Vm,
};

use super::pause::{Cause, Site};
use super::{Debugger, Location, Microtask, Reason, Script, Suspension};
use crate::protocol::object;
use crate::{AsyncCallType, Controller, ProfilingReason};

/// What the global object has while the domain is enabled.
pub(crate) struct Attachment(pub(crate) Weak<Controller>);

impl Attachment {
    fn with(&self, handle: impl FnOnce(&Controller)) {
        if let Some(controller) = self.0.upgrade() {
            handle(&controller);
        }
    }

    fn unless_paused(&self, handle: impl FnOnce(&Controller)) {
        self.with(|controller| {
            if !controller.debugger.is_paused() {
                handle(controller);
            }
        });
    }
}

impl bun_engine_vm::Debugger for Attachment {
    fn did_parse(&self, cx: &Cx, provider: &SourceProvider, error: Option<&CompileError>) {
        self.with(|controller| controller.did_parse(cx, provider, error));
    }

    fn did_create_wasm_module(&self, cx: &Cx, module: Gc<JsCell>) {
        self.with(|controller| controller.did_create_wasm_module(cx, module));
    }

    fn did_link(&self, cx: &Cx, code_block: &CodeBlock) {
        self.with(|controller| controller.debugger.count_requests(cx, code_block));
    }

    fn did_reach_hook(&self, cx: &mut Cx, frame: &CallFrame, hook: DebugHook) {
        self.unless_paused(|controller| controller.did_reach_hook(cx, frame, hook));
    }

    fn did_reach_suspension(
        &self,
        cx: &Cx,
        frame: &CallFrame,
        hook: DebugHook,
        coroutine: Gc<Coroutine>,
    ) {
        self.unless_paused(|controller| match hook {
            DebugHook::WillAwait | DebugHook::WillYield => {
                let awaits = hook == DebugHook::WillAwait;
                (controller.debugger).will_suspend(cx, frame, coroutine, awaits);
            }
            _ => controller.did_resume(cx, frame, coroutine),
        });
    }

    fn will_replace_frame(&self, cx: &Cx, frame: &CallFrame) {
        self.unless_paused(|controller| controller.debugger.will_return(cx, frame));
    }

    fn will_throw(&self, cx: &mut Cx, exception: Gc<Exception>) {
        self.unless_paused(|controller| controller.will_throw(cx, exception));
    }

    fn did_unwind_frame(&self, cx: &mut Cx, frame: &CallFrame) {
        self.unless_paused(|controller| {
            if frame.callee().cell_type() == CellType::Callee {
                controller.did_execute_program(cx, frame);
            } else if controller.debugger.target_frame.get() == frame.address() {
                (controller.debugger.target_frame).set(caller_with_hooks(cx, frame));
            }
        });
    }

    fn will_call_native_function(&self, cx: &mut Cx, frame: &CallFrame) {
        self.unless_paused(|controller| controller.will_call_native_function(cx, frame));
    }

    fn microtask_event(&self, vm: &Vm, event: MicrotaskEvent, job: InternalMicrotask, id: u64) {
        self.with(|controller| controller.microtask_event(vm, event, job, id));
    }
}

fn callers<'a>(vm: &'a Vm, frame: usize) -> impl Iterator<Item = &'a CallFrame> {
    (vm.machine_frames()).skip_while(move |it| it.address() <= frame)
}

/// The address of the nearest one that can pause, or zero.
pub(super) fn caller_that_can_pause(vm: &Vm, frame: usize) -> usize {
    let can_pause = |it: &&CallFrame| it.code_block().is_some_and(|it| it.has_debug_hooks());
    (callers(vm, frame).find(can_pause)).map_or(0, CallFrame::address)
}

fn caller_with_hooks(vm: &Vm, frame: &CallFrame) -> usize {
    caller_that_can_pause(vm, frame.address())
}

fn function_name(code_block: &CodeBlock) -> Option<StringRef> {
    let function = code_block.executable().downcast::<FunctionExecutable>()?;
    Some(function.name().clone())
}

fn lines_of(code_block: &CodeBlock, provider: &SourceProvider) -> RangeInclusive<i32> {
    let Some(function) = code_block.executable().downcast::<FunctionExecutable>() else {
        return i32::MIN..=i32::MAX;
    };
    let (range, line) = (function.info().range(), |offset| {
        Location::of(provider, offset).position.line
    });
    line(range.start)..=line(range.end)
}

impl Debugger {
    /// False in the frames that a step passes over.
    fn may_pause_in(&self, frame: &CallFrame) -> bool {
        self.pauses_at_next_opportunity.get()
            || self.target_frame.get() == frame.address()
            || self.pending_breakpoint.borrow().is_some()
            || (frame.code_block()).is_some_and(|it| it.debugger_requests().get() != 0)
    }

    /// Finds out how many breakpoints may be hit in the code.
    pub(super) fn count_requests(&self, vm: &Vm, code_block: &CodeBlock) {
        let mut requests = 0;
        let provider = code_block.source_provider();
        if let Some(breakpoints) = self.breakpoints.borrow().get(&provider.id())
            && let lines = lines_of(code_block, &provider)
            && (breakpoints.iter().filter_map(|it| it.location))
                .any(|it| lines.contains(&it.position.line))
        {
            let bytes = code_block.body().instructions();
            let hooks = Instructions::new(bytes, 0..bytes.len() as u32)
                .filter(|(_, instruction)| instruction.opcode == Opcode::Debug);
            for (offset, _) in hooks {
                let hook = Location::of(&provider, code_block.position(offset).divot).position;
                let places = breakpoints.iter().filter_map(|it| it.location);
                requests += places
                    .map(|it| it.position)
                    .filter(|&it| it == hook || (it.column == 0 && it.line == hook.line))
                    .count();
            }
        }
        let symbolic = self.symbolic_breakpoints.borrow();
        if !symbolic.is_empty()
            && let Some(name) = function_name(code_block)
        {
            requests += (symbolic.iter().filter(|it| it.matches(vm, &name))).count();
        }
        code_block.debugger_requests().set(requests as u32);
    }

    /// A step over the end of a function is a step out of it.
    fn will_return(&self, vm: &Vm, frame: &CallFrame) {
        self.is_past_first_expression.set(true);
        if self.target_frame.get() == frame.address() {
            self.target_frame.set(caller_with_hooks(vm, frame));
            self.pauses_at_expressions.set(true);
        }
    }

    fn will_suspend(&self, vm: &Vm, frame: &CallFrame, coroutine: Gc<Coroutine>, awaits: bool) {
        self.is_past_first_expression.set(true);
        if self.target_frame.get() != frame.address() {
            return;
        }
        self.suspension.replace(Some(Suspension {
            coroutine: bun_engine_vm::Weak::new(vm, coroutine),
            awaits_since: awaits.then(monotonic_seconds),
            pauses_at_expressions: self.pauses_at_expressions.get(),
        }));
        self.forget_immediate_pause();
        self.forget_target_frame();
    }

    /// After a while a pause would come as a surprise.
    fn abandon_long_await(&self, vm: &Vm) {
        const MAX_SECONDS: f64 = 1.0;
        let is_long = |since| monotonic_seconds() - since > MAX_SECONDS;
        let mut suspension = self.suspension.borrow_mut();
        let abandoned = suspension.take_if(|it| it.awaits_since.is_some_and(is_long));
        drop(suspension);
        if abandoned.is_some() {
            self.stop_stepping_if_done(vm);
        }
    }

    /// Whether what is thrown now is going to be caught, as far as can be told.
    fn predicts_catch(&self, vm: &Vm, thrown: bun_engine_vm::Value) -> bool {
        let catches = |frame: bun_engine_vm::VisitedFrame<'_>| {
            (frame.code_block).is_some_and(|it| it.has_catch_handler_for(frame.bytecode_offset))
                || frame.catches_in_wasm(vm, thrown)
        };
        let runs_module = || {
            let entered = StackVisitor::frames(vm)
                .take_while(|frame| frame.entry_frame == vm.top_entry_frame());
            (entered.last()).is_some_and(|frame| frame.kind() == FrameKind::Module)
        };
        let microtask = (self.microtasks.borrow().last()).and_then(|it| it.catches_for);
        self.catching_calls.get() != 0
            || microtask.is_some_and(|it| vm.outer_entry_frame() == Some(it) && !runs_module())
            || StackVisitor::frames(vm).any(catches)
    }
}

impl Controller {
    pub(super) fn did_parse(
        &self,
        cx: &Cx,
        provider: &SourceProvider,
        error: Option<&CompileError>,
    ) {
        let (debugger, id) = (&self.debugger, provider.id());
        if debugger.scripts.borrow().contains_key(&id) {
            return;
        }
        if let Some(error) = error.filter(|it| it.kind == CompileErrorKind::Syntax) {
            if debugger.failed_scripts.borrow_mut().insert(id) {
                let params = object! {
                    "url": provider.url().cloned().unwrap_or_default(),
                    "scriptSource": provider.source(),
                    "startLine": provider.start_position().0.wrapping_add(1),
                    "errorLine": provider.position_in_document(error.offset).line,
                    "errorMessage": &error.message,
                };
                self.notify("Debugger.scriptFailedToParse", params);
            }
            return;
        }
        self.add_script(cx, Script::new(provider));
    }

    pub(super) fn did_create_wasm_module(&self, cx: &Cx, module: Gc<JsCell>) {
        let module = (cx.hooks().describe_wasm_module)(module);
        self.add_script(cx, Script::for_wasm(module));
    }

    fn add_script(&self, cx: &Cx, script: Script) {
        let (debugger, script) = (&self.debugger, Rc::new(script));
        let realm = self.registries.id_of_realm(cx);
        self.notify("Debugger.scriptParsed", script.to_json(realm));
        (debugger.scripts.borrow_mut()).insert(script.id(), Rc::clone(&script));
        debugger.apply_blackboxes(cx, &script);
        self.apply_url_breakpoints(cx, &script);
    }

    fn microtask_event(&self, vm: &Vm, event: MicrotaskEvent, job: InternalMicrotask, id: u64) {
        let (debugger, call) = (&self.debugger, (AsyncCallType::Microtask, id));
        let is_active = debugger.breakpoints_are_active();
        let breakpoint = (debugger.on_microtasks.borrow().clone()).filter(|_| is_active);
        match event {
            MicrotaskEvent::DidQueue if is_active => {
                debugger.async_calls.did_schedule(vm, call, true);
            }
            MicrotaskEvent::DidQueue => {}
            MicrotaskEvent::WillRun => {
                let catches = job != InternalMicrotask::CallWithArguments
                    && job < InternalMicrotask::PromiseFulfillWithoutHandler;
                debugger.microtasks.borrow_mut().push(Microtask {
                    catches_for: catches.then(|| vm.top_entry_frame()),
                    start: self.will_evaluate_script(),
                });
                debugger.async_calls.will_dispatch(call);
                if let Some(breakpoint) = breakpoint {
                    debugger.schedule(vm, breakpoint, Reason::Microtask, None);
                }
            }
            MicrotaskEvent::DidRun => {
                let microtask = debugger.microtasks.borrow_mut().pop();
                debugger.async_calls.did_dispatch(call);
                if let Some(breakpoint) = breakpoint
                    && (debugger.pending_breakpoint.borrow_mut())
                        .take_if(|it| Rc::ptr_eq(it, &breakpoint))
                        .is_some()
                {
                    debugger.announce(Reason::Other, None);
                }
                if let Some(start) = microtask.and_then(|it| it.start) {
                    self.did_evaluate_script(start, ProfilingReason::Microtask);
                }
            }
        }
    }

    fn did_resume(&self, vm: &Vm, frame: &CallFrame, coroutine: Gc<Coroutine>) {
        let debugger = &self.debugger;
        debugger.abandon_long_await(vm);
        let suspension = (debugger.suspension.borrow_mut())
            .take_if(|it| it.coroutine.get(vm) == Some(coroutine));
        if let Some(suspension) = suspension {
            let did_await = suspension.awaits_since.is_some();
            debugger.is_after_await.set(did_await);
            debugger.is_past_first_expression.set(true);
            debugger.target_frame.set(frame.address());
            (debugger.pauses_at_expressions).set(did_await || suspension.pauses_at_expressions);
            self.wait_for_idle(vm);
        }
    }

    fn did_reach_hook(&self, cx: &mut Cx, frame: &CallFrame, hook: DebugHook) {
        let debugger = &self.debugger;
        debugger.abandon_long_await(cx);
        match hook {
            DebugHook::WillExecuteStatement => {
                debugger.is_past_first_expression.set(false);
                self.pause_if_needed_in(cx, frame);
            }
            // The first of a statement is where that has paused.
            DebugHook::WillExecuteExpression => {
                if debugger.is_past_first_expression.replace(true)
                    && (debugger.pauses_at_next_opportunity.get()
                        || debugger.pauses_at_expressions.get()
                        || debugger.pending_breakpoint.borrow().is_some())
                {
                    self.pause_if_needed_in(cx, frame);
                }
            }
            DebugHook::DidReachDebuggerStatement => {
                let breakpoint = debugger.on_debugger_statements.borrow().clone();
                if breakpoint.is_some() {
                    debugger.pending_breakpoint.replace(breakpoint);
                    debugger.set_stepping(cx, true);
                    self.pause_if_needed(cx, Site::of(frame), Cause::DebuggerStatement);
                }
            }
            DebugHook::DidEnterCallFrame if debugger.may_pause_in(frame) => {
                if let Some(name) = frame.code_block().and_then(|it| function_name(&it))
                    && let Some(breakpoint) = debugger.symbolic_breakpoint_for(cx, &name)
                {
                    let data = Some(object! { "name": name });
                    debugger.schedule(cx, breakpoint, Reason::FunctionCall, data);
                }
            }
            DebugHook::WillLeaveCallFrame => {
                self.pause_if_needed_in(cx, frame);
                debugger.will_return(cx, frame);
            }
            DebugHook::DidReturnFromTailCall => debugger.will_return(cx, frame),
            DebugHook::DidExecuteProgram => self.did_execute_program(cx, frame),
            _ => {}
        }
    }

    fn pause_if_needed_in(&self, cx: &mut Cx, frame: &CallFrame) {
        if self.debugger.may_pause_in(frame) {
            self.pause_if_needed(cx, Site::of(frame), Cause::Step);
        }
    }

    fn did_execute_program(&self, cx: &mut Cx, frame: &CallFrame) {
        let (debugger, site) = (&self.debugger, Site::of(frame));
        self.pause_if_needed(cx, site, Cause::EndOfProgram);
        if !debugger.is_stepping.get() {
            return;
        }
        let keeps_pause = debugger.pauses_at_next_opportunity.get()
            && debugger.is_blackboxed(site.location, Cause::EndOfProgram);
        debugger.is_past_first_expression.set(true);
        if debugger.target_frame.get() == frame.address() {
            debugger.target_frame.set(caller_with_hooks(cx, frame));
            debugger.pauses_at_next_opportunity.set(true);
        }
        // A step does not lead into whatever program comes next, unless this one was not to be seen.
        if callers(cx, frame.address()).next().is_none() {
            let was_after_blackboxed_script = debugger.is_after_blackboxed_script.get();
            debugger.forget_steps();
            if keeps_pause {
                debugger.pause_at_next_opportunity(cx);
                (debugger.is_after_blackboxed_script).set(was_after_blackboxed_script);
            }
        }
    }

    fn will_throw(&self, cx: &mut Cx, exception: Gc<Exception>) {
        let debugger = &self.debugger;
        let on_all = debugger.on_all_exceptions.borrow().clone();
        let on_uncaught = debugger.on_uncaught_exceptions.borrow().clone();
        if !debugger.breakpoints_are_active()
            || debugger.ignores_exceptions.get()
            || (on_all.is_none() && on_uncaught.is_none())
            || (exception.value().downcast::<ErrorInstance>())
                .is_some_and(|it| it.is_stack_overflow() || it.is_out_of_memory())
        {
            return;
        }
        let is_uncaught = |_: &_| !debugger.predicts_catch(cx, exception.value());
        let breakpoint = on_all.or_else(|| on_uncaught.filter(is_uncaught));
        if breakpoint.is_some() {
            debugger.pending_breakpoint.replace(breakpoint);
            debugger.set_stepping(cx, true);
        }
        let site = Site::innermost(cx);
        self.pause_if_needed(cx, site, Cause::Exception(exception.value()));
    }

    fn will_call_native_function(&self, cx: &mut Cx, frame: &CallFrame) {
        let callee = frame.callee();
        let name = match callee.downcast::<JsFunction>() {
            Some(function) => function.name(),
            None => callee.cast::<InternalFunction>().name(),
        };
        if let Some(breakpoint) = self.debugger.symbolic_breakpoint_for(cx, &name) {
            let data = Some(object! { "name": name });
            self.break_program(cx, breakpoint, Reason::FunctionCall, data);
        }
    }

    pub(crate) fn did_fail_assertion(&self, cx: &mut Cx, message: Option<StringRef>) {
        let breakpoint = self.debugger.on_assertions.borrow().clone();
        if let Some(breakpoint) = breakpoint.filter(|_| self.debugger.breakpoints_are_active()) {
            let data = Some(object! { "message" => message });
            self.break_program(cx, breakpoint, Reason::Assert, data);
        }
    }
}
