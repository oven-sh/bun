//! From an opportunity to pause to the end of the pause.

use std::rc::Rc;

use bun_engine_bytecode::Origin;
use bun_engine_text::StringRef;
use bun_engine_vm::{
    CallFrame, CodeBlock, Cx, DebuggerFrame, FunctionExecutable, Gc, JsResult, Message, RootVec,
    StackFrame, StackVisitor, Value, Vm,
};

use super::breakpoint::{Action, ActionKind};
use super::scope::{caught_value, scope_chain};
use super::{Breakpoint, Debugger, Location, Resumed};
use crate::Controller;
use crate::protocol::{Object, Outcome, object};
use crate::remote::{Detail, Remote, Wanted, settle};

/// What gives the opportunity.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Cause {
    Step,
    EndOfProgram,
    DebuggerStatement,
    Exception(Value),
}

/// What the frontend is told.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Reason {
    Exception,
    Assert,
    DebuggerStatement,
    Breakpoint,
    PauseOnNextStatement,
    Microtask,
    FunctionCall,
    BlackboxedScript,
    #[default]
    Other,
}

impl Reason {
    fn name(self) -> &'static str {
        match self {
            Reason::Exception => "exception",
            Reason::Assert => "assert",
            Reason::DebuggerStatement => "DebuggerStatement",
            Reason::Breakpoint => "Breakpoint",
            Reason::PauseOnNextStatement => "PauseOnNextStatement",
            Reason::Microtask => "Microtask",
            Reason::FunctionCall => "FunctionCall",
            Reason::BlackboxedScript => "BlackboxedScript",
            Reason::Other => "other",
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct Announcement {
    reason: Reason,
    data: Option<Object>,
}

/// Where running code is.
#[derive(Clone, Copy)]
pub(super) struct Site {
    /// The address, or zero if no script is running.
    frame: usize,
    pub(super) location: Location,
    is_in_source: bool,
}

fn location_in(code_block: &CodeBlock, bytecode_offset: u32) -> Location {
    let offset = code_block.position(bytecode_offset).divot;
    Location::of(&code_block.source_provider(), offset)
}

impl Site {
    /// Of a frame that is at a debug hook, or is being left.
    pub(super) fn of(frame: &CallFrame) -> Site {
        let code_block = frame.code_block().filter(|it| !it.is_optimized());
        let code = code_block.map(|it| (it, it.bytecode_offset_of(frame.call_site())));
        Site::new(frame.address(), code)
    }

    pub(super) fn innermost(vm: &Vm) -> Site {
        let frame = StackVisitor::frames(vm).find(|it| it.wasm.is_none());
        let code = frame.and_then(|it| Some((it.code_block?, it.bytecode_offset)));
        Site::new(frame.map_or(0, |it| it.machine_frame.address()), code)
    }

    fn new(frame: usize, code: Option<(Gc<CodeBlock>, u32)>) -> Site {
        let function = code.and_then(|it| it.0.executable().downcast::<FunctionExecutable>());
        Site {
            frame,
            location: code.map_or(Location::NOWHERE, |it| location_in(&it.0, it.1)),
            is_in_source: !function
                .is_some_and(|it| it.info().origin().contains(Origin::DEFAULT_CONSTRUCTOR)),
        }
    }
}

fn frames_from(cx: &Cx, first: usize) -> RootVec<DebuggerFrame> {
    let mut frames = DebuggerFrame::stack_from(cx, first);
    if frames.is_empty() {
        frames.push(DebuggerFrame::outside_of_code(cx));
    }
    frames
}

/// The first that has code to evaluate in.
fn frame_for_evaluation(frames: &[DebuggerFrame]) -> &DebuggerFrame {
    let with_code = frames.iter().find(|it| it.code_block.is_some());
    with_code.unwrap_or(&frames[0])
}

fn backtrace_group() -> StringRef {
    StringRef::from_literal("backtrace")
}

fn breakpoint_data(breakpoint: &Breakpoint) -> Option<Object> {
    Some(object! { "breakpointId": breakpoint.id.as_ref()? })
}

enum Verdict {
    Continue,
    /// For a breakpoint at a location, if any.
    Pause(Option<Rc<Breakpoint>>),
}

impl Debugger {
    pub(super) fn announce(&self, reason: Reason, data: Option<Object>) {
        let old = self.announcement.replace(Announcement { reason, data });
        if !matches!(old.reason, Reason::Other | Reason::BlackboxedScript) {
            self.last_announcement.replace(old);
        }
    }

    /// Unless another one has come first.
    pub(super) fn schedule(
        &self,
        vm: &Vm,
        breakpoint: Rc<Breakpoint>,
        reason: Reason,
        data: Option<Object>,
    ) {
        if self.pending_breakpoint.borrow().is_none() {
            self.pending_breakpoint.replace(Some(breakpoint));
            self.set_stepping(vm, true);
            self.announce(reason, data);
        }
    }

    pub(super) fn is_blackboxed(&self, location: Location, cause: Cause) -> bool {
        let position = location.position;
        self.script(location.script).is_some_and(|script| {
            script.blackboxed_ranges.borrow().iter().any(|range| {
                range.contains(&position) || (cause == Cause::EndOfProgram && range.end == position)
            })
        })
    }

    /// One at the start of a line is for whatever comes first on it.
    fn breakpoint_hit_at(&self, location: Location) -> Option<Rc<Breakpoint>> {
        if !self.breakpoints_are_active() {
            return None;
        }
        let here = location.position;
        let is_new_line = self.last_line.get() != Some((location.script, here.line));
        let breakpoints = self.breakpoints.borrow();
        let hit = breakpoints.get(&location.script)?.iter().find(|it| {
            (it.location.map(|it| it.position)).is_some_and(|it| {
                it == here || (is_new_line && it.line == here.line && it.column == 0)
            })
        });
        hit.cloned()
    }

    fn defer_past_blackboxed_script(&self, vm: &Vm, breakpoint: Option<&Breakpoint>) {
        self.is_after_blackboxed_script.set(true);
        if let Some(breakpoint) = breakpoint {
            self.announce(Reason::Breakpoint, breakpoint_data(breakpoint));
        }
        self.pause_at_next_opportunity(vm);
    }

    fn announce_end_of_blackboxed_script(&self, breakpoint: Option<&Breakpoint>) {
        if self.announcement.borrow().reason == Reason::Other {
            self.last_announcement.borrow_mut().reason = Reason::Other;
        }
        self.announce(Reason::BlackboxedScript, None);
        let original = match breakpoint {
            Some(breakpoint) => Some((Reason::Breakpoint, breakpoint_data(breakpoint))),
            None => {
                let mut last = self.last_announcement.borrow_mut();
                last.data.take().map(|data| (last.reason, Some(data)))
            }
        };
        let data = original.map(
            |(reason, data)| object! { "originalReason": reason.name(), "originalData" => data },
        );
        self.announce(Reason::BlackboxedScript, data);
    }
}

impl Controller {
    pub(super) fn break_program(
        &self,
        cx: &mut Cx,
        breakpoint: Rc<Breakpoint>,
        reason: Reason,
        data: Option<Object>,
    ) {
        let (debugger, site) = (&self.debugger, Site::innermost(cx));
        if debugger.is_paused() || site.frame == 0 {
            return;
        }
        debugger.announce(reason, data);
        debugger.pending_breakpoint.replace(Some(breakpoint));
        debugger.set_stepping(cx, true);
        let _defer = cx.defer_termination();
        self.pause_if_needed(cx, site, Cause::Step);
    }

    pub(super) fn pause_if_needed(&self, cx: &mut Cx, site: Site, cause: Cause) {
        let debugger = &self.debugger;
        if !site.is_in_source {
            return;
        }
        let is_after_blackboxed_script = debugger.is_after_blackboxed_script.get();
        let target = debugger.target_frame.get();
        let is_at_target = target != 0 && target == site.frame;
        let is_next_opportunity = debugger.pauses_at_next_opportunity.get();
        let breakpoints = [
            debugger.breakpoint_hit_at(site.location),
            debugger.pending_breakpoint.take(),
        ];
        let Location { script, position } = site.location;
        debugger.last_line.set(Some((script, position.line)));
        if !is_next_opportunity && !is_at_target && breakpoints.iter().all(Option::is_none) {
            return;
        }
        let mut deferred = debugger.deferred_breakpoints.borrow_mut();
        for breakpoint in breakpoints.into_iter().flatten() {
            if !deferred.iter().any(|it| Rc::ptr_eq(it, &breakpoint)) {
                deferred.push(breakpoint);
            }
        }
        drop(deferred);

        let completes_step = match is_next_opportunity {
            true => !is_after_blackboxed_script,
            false => is_at_target,
        };
        let is_after_await = debugger.is_after_await.get();
        debugger.forget_immediate_pause();
        // A breakpoint on the way may turn out not to pause.
        if target == 0 || is_at_target {
            debugger.forget_target_frame();
        }
        let is_blackboxed = debugger.is_blackboxed(site.location, cause);
        if is_blackboxed && debugger.blackboxes_evaluations.get() {
            return debugger.defer_past_blackboxed_script(cx, None);
        }

        debugger.is_paused.set(true);
        let breakpoint = match self.evaluate_breakpoints(cx, site) {
            Verdict::Pause(breakpoint) => Some(breakpoint),
            Verdict::Continue => completes_step.then_some(None),
        };
        match breakpoint.filter(|_| debugger.is_enabled()) {
            Some(breakpoint) if is_blackboxed => {
                debugger.defer_past_blackboxed_script(cx, breakpoint.as_deref());
            }
            Some(breakpoint) => {
                debugger.forget_target_frame();
                debugger.forget_suspension();
                if is_after_blackboxed_script {
                    debugger.announce_end_of_blackboxed_script(breakpoint.as_deref());
                } else if debugger.announcement.borrow().reason == Reason::Other {
                    self.announce_cause(cx, cause, breakpoint.as_deref(), is_after_await);
                }
                self.pause(cx, site, cause);
            }
            None if !debugger.is_pause_requested.get() => debugger.announce(Reason::Other, None),
            None => {}
        }
        debugger.is_paused.set(false);
        debugger.stop_stepping_if_done(cx);
    }

    fn evaluate_breakpoints(&self, cx: &mut Cx, site: Site) -> Verdict {
        let breakpoints = self.debugger.deferred_breakpoints.take();
        if breakpoints.is_empty() {
            return Verdict::Pause(None);
        }
        let mut first = None;
        for breakpoint in breakpoints {
            let condition = &breakpoint.options.condition;
            let holds = condition.is_empty() || {
                let result = self.evaluate_at(cx, site, condition);
                result.is_ok_and(|it| it.to_boolean(cx))
            };
            if !holds || !breakpoint.count_hit() {
                continue;
            }
            (self.debugger.last_probe_batch).update(|batch| batch.wrapping_add(1));
            for action in &breakpoint.options.actions {
                if self.debugger.is_enabled() {
                    self.perform(cx, site, action);
                }
            }
            if !breakpoint.options.continues {
                first.get_or_insert(breakpoint);
            }
        }
        match first {
            Some(first) => Verdict::Pause(first.location.is_some().then_some(first)),
            None => Verdict::Continue,
        }
    }

    /// The error is what was thrown.
    fn evaluate_at(&self, cx: &mut Cx, site: Site, text: &StringRef) -> Result<Value, Value> {
        let frames = frames_from(cx, site.frame);
        let frame = frame_for_evaluation(&frames);
        self.on_behalf_of_frontend(cx, |cx| {
            let result = (self.remote(cx)).run_in_frame(cx, frame, text.clone(), true);
            result.map_err(|thrown| settle(cx, cx.catch_value(thrown)).unwrap_or_default())
        })
    }

    fn perform(&self, cx: &mut Cx, site: Site, action: &Action) {
        match action.kind {
            ActionKind::Log => self.log_for_breakpoint(cx, action.data.clone()),
            ActionKind::Evaluate => drop(self.evaluate_at(cx, site, &action.data)),
            ActionKind::Sound => {
                let params = object! { "breakpointActionId": action.id };
                self.notify("Debugger.playBreakpointActionSound", params);
            }
            ActionKind::Probe => {
                let (Ok(value) | Err(value)) = self.evaluate_at(cx, site, &action.data);
                let group = action.object_group();
                let payload = self.remote(cx).wrap(cx, value, &group, Detail::Preview);
                (self.debugger.last_probe_sample).update(|sample| sample.wrapping_add(1));
                if let Some(payload) = settle(cx, payload) {
                    let sample = object! {
                        "probeId": action.id,
                        "batchId": self.debugger.last_probe_batch.get(),
                        "sampleId": self.debugger.last_probe_sample.get(),
                        "timestamp": self.stopwatch.elapsed(),
                        "payload": payload,
                    };
                    self.notify("Debugger.didSampleProbe", object! { "sample": sample });
                }
            }
        }
    }

    fn announce_cause(
        &self,
        cx: &mut Cx,
        cause: Cause,
        breakpoint: Option<&Breakpoint>,
        is_after_await: bool,
    ) {
        let debugger = &self.debugger;
        match (breakpoint, cause) {
            (None, Cause::Step) if is_after_await => {
                let last = debugger.last_announcement.borrow().clone();
                debugger.announcement.replace(last);
            }
            (Some(breakpoint), _) => {
                if let data @ Some(_) = breakpoint_data(breakpoint) {
                    debugger.announce(Reason::Breakpoint, data);
                }
            }
            (None, Cause::DebuggerStatement) => debugger.announce(Reason::DebuggerStatement, None),
            (None, Cause::Exception(value)) => {
                let data = (self.remote(cx)).wrap(cx, value, &backtrace_group(), Detail::None);
                debugger.announce(Reason::Exception, settle(cx, data));
            }
            (None, Cause::Step | Cause::EndOfProgram) => {}
        }
    }

    fn pause(&self, cx: &mut Cx, site: Site, cause: Cause) {
        let (debugger, remote) = (&self.debugger, self.remote(cx));
        let frames = frames_from(cx, site.frame);
        let exception = match cause {
            Cause::Exception(value) => Some(value),
            _ => frames.iter().find_map(caught_value),
        };
        self.registries.of_realm(cx).set_exception(exception);
        debugger.paused_frame.set(Some(site.frame));
        debugger.resumed.set(Resumed::NotDue);
        debugger.pauses_when_idle.set(false);
        let call_frames = wrap_frames(cx, remote, &frames);
        let Announcement { reason, data } = debugger.announcement.borrow().clone();
        let trace = debugger.async_calls.current_trace();
        let params = object! {
            "callFrames": settle(cx, call_frames).unwrap_or_default(),
            "reason": reason.name(),
            "data" => data,
            "asyncStackTrace" => trace.and_then(|it| it.to_json()),
        };
        self.notify("Debugger.paused", params);
        debugger.is_pause_requested.set(false);
        debugger.remove_destination(cx);

        self.stopwatch.stop();
        self.update_sampling(cx);
        debugger.is_done_pausing.set(false);
        self.host.run_while_paused(cx, &debugger.is_done_pausing);
        (self.stopwatch).resume(self.script_profiler.takes_samples());

        debugger.paused_frame.set(None);
        self.update_sampling(cx);
        self.registries.release_group(cx, &backtrace_group());
        (self.registries.all(cx).iter()).for_each(|it| it.set_exception(None));
        debugger.announce(Reason::Other, None);
        if debugger.resumed.get() == Resumed::WhenContinued {
            self.notify_resumed();
        }
    }

    pub(super) fn notify_resumed(&self) {
        self.notify_without_params("Debugger.resumed");
    }

    pub(crate) fn evaluate_on_call_frame(
        &self,
        cx: &mut Cx,
        remote: Remote<'_>,
        ordinal: Option<i32>,
        text: StringRef,
        has_api: bool,
        wanted: &Wanted,
    ) -> Outcome {
        let frames = frames_from(cx, self.debugger.check_paused()?);
        let callers = frames.get(ordinal.unwrap_or(0).max(0) as usize..);
        let callers = callers.filter(|it| !it.is_empty());
        let callers = callers.ok_or("Could not find call frame with given id")?;
        let result = remote.run_in_frame(cx, frame_for_evaluation(callers), text, has_api);
        remote.report(cx, result, wanted)
    }
}

/// `Debugger.CallFrame` for each.
fn wrap_frames(cx: &mut Cx, remote: Remote<'_>, frames: &[DebuggerFrame]) -> JsResult<Vec<Object>> {
    let (group, realm) = (backtrace_group(), remote.realm_id());
    let mut wrapped = Vec::with_capacity(frames.len());
    for (ordinal, frame) in frames.iter().enumerate() {
        let mut scopes = Vec::new();
        for scope in &scope_chain(cx, frame) {
            let is_empty = scope.is_empty(cx);
            let is_empty = settle(cx, is_empty).unwrap_or(false);
            scopes.push(object! {
                "object": remote.wrap(cx, scope.object.into(), &group, Detail::None)?,
                "type": scope.kind,
                "name" => Some(&scope.name).filter(|it| !it.is_empty()),
                "location" => scope.location.map(Location::to_json),
                "empty" => is_empty.then_some(true),
            });
        }
        let name = frame.code_block.map_or_default(|code_block| {
            let frame = StackFrame {
                callee: frame.callee.map(|it| it.cell()),
                code_block: Some(code_block),
                bytecode_offset: frame.bytecode_offset,
                is_async: false,
                is_wasm: false,
            };
            frame.function_name(cx)
        });
        let location = (frame.code_block).map(|it| location_in(&it, frame.bytecode_offset));
        let id = format_args!("{{\"ordinal\":{ordinal},\"injectedScriptId\":{realm}}}");
        let this = frame.this_value(cx);
        wrapped.push(object! {
            "callFrameId": id.into_string(),
            "functionName": name,
            "location": location.unwrap_or(Location::NOWHERE).to_json(),
            "scopeChain": scopes,
            "this": remote.wrap(cx, this, &group, Detail::None)?,
            "isTailDeleted": frame.is_tail_deleted,
        });
    }
    Ok(wrapped)
}
