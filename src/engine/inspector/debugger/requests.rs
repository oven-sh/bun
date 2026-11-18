//! What the frontend asks for.

use core::ops::Range;
use std::collections::BTreeMap;
use std::rc::Rc;

use bun_engine_text::StringRef;
use bun_engine_vm::{
    CellType, Cx, GlobalObject, JsFunction, Message, ModuleExecutable, Vm, root_vec,
};

use super::events::caller_that_can_pause;
use super::{
    Attachment, Breakpoint, Debugger, Location, Options, Position, Reason, Resumed, Script,
};
use crate::protocol::{Outcome, object};
use crate::search::Query;
use crate::{Controller, ProfilingReason};

/// Applies to the scripts that are yet to come too.
pub(super) struct UrlBreakpoint {
    id: StringRef,
    url: Query,
    position: Position,
    options: Rc<Options>,
}

pub(super) struct SymbolicBreakpoint {
    symbol: Query,
    breakpoint: Rc<Breakpoint>,
}

impl SymbolicBreakpoint {
    pub(super) fn matches(&self, vm: &Vm, name: &StringRef) -> bool {
        self.symbol.matches(vm, name.text())
    }
}

pub(super) struct Blackbox {
    url: Query,
    /// None stand for all of the script.
    ranges: Vec<Range<Position>>,
}

#[derive(Clone, Copy)]
pub(crate) enum Step {
    Next,
    Over,
    Into,
    Out,
}

fn breakpoint_id(source: impl core::fmt::Display, position: Position) -> StringRef {
    let (line, column) = (position.line as u32, position.column as u32);
    format_args!("{source}:{line}:{column}").into_string()
}

impl Debugger {
    /// The address of the innermost frame.
    pub(crate) fn check_paused(&self) -> Outcome<usize> {
        Ok(self.paused_frame.get().ok_or("Must be paused")?)
    }

    /// In the code of that script, or in all.
    fn recount_requests(&self, vm: &Vm, script: Option<usize>) {
        vm.for_each_code_block(|code_block| {
            if code_block.has_debug_hooks()
                && script.is_none_or(|it| it == code_block.executable().provider().id())
                && self.is_attached_to(&code_block.global())
            {
                self.count_requests(vm, &code_block);
            }
        });
    }

    fn is_attached_to(&self, global: &GlobalObject) -> bool {
        let attachment = global.debugger().map(|it| it as Rc<dyn core::any::Any>);
        let attachment = attachment.and_then(|it| it.downcast::<Attachment>().ok());
        let controller = attachment.and_then(|it| it.0.upgrade());
        controller.is_some_and(|it| core::ptr::eq(&raw const it.debugger, self))
    }

    /// `None` if there is one already.
    fn add_breakpoint(
        &self,
        vm: &Vm,
        location: Location,
        id: Option<StringRef>,
        options: Rc<Options>,
    ) -> Option<Rc<Breakpoint>> {
        let mut breakpoints = self.breakpoints.borrow_mut();
        let in_script = breakpoints.entry(location.script).or_default();
        if in_script.iter().any(|it| it.location == Some(location)) {
            return None;
        }
        let breakpoint = Breakpoint::at(location, id, options);
        in_script.push(Rc::clone(&breakpoint));
        drop(breakpoints);
        self.recount_requests(vm, Some(location.script));
        Some(breakpoint)
    }

    fn remove_breakpoints(
        &self,
        vm: &Vm,
        matches: impl Fn(&Rc<Breakpoint>) -> bool,
    ) -> Vec<Rc<Breakpoint>> {
        let mut removed = Vec::new();
        self.breakpoints.borrow_mut().retain(|_, in_script| {
            removed.extend(in_script.extract_if(.., |it| matches(it)));
            !in_script.is_empty()
        });
        for location in removed.iter().filter_map(|it| it.location) {
            self.recount_requests(vm, Some(location.script));
        }
        removed
    }

    pub(super) fn remove_destination(&self, vm: &Vm) {
        if let Some(destination) = self.destination.take() {
            self.remove_breakpoints(vm, |it| Rc::ptr_eq(it, &destination));
        }
    }

    fn apply_url_breakpoint(
        &self,
        vm: &Vm,
        breakpoint: &UrlBreakpoint,
        script: &Script,
    ) -> Option<Location> {
        if !(breakpoint.url).matches(vm, script.url_for_breakpoints()) {
            return None;
        }
        let location = script.resolve(vm, breakpoint.position)?;
        let (id, options) = (breakpoint.id.clone(), Rc::clone(&breakpoint.options));
        self.add_breakpoint(vm, location, Some(id), options)?;
        Some(location)
    }

    pub(crate) fn set_breakpoint_by_url(
        &self,
        vm: &Vm,
        url: StringRef,
        is_regexp: bool,
        position: Position,
        options: Rc<Options>,
    ) -> Outcome {
        let slash = if is_regexp { "/" } else { "" };
        let id = breakpoint_id(format_args!("{slash}{url}{slash}"), position);
        if self.url_breakpoints.borrow().iter().any(|it| it.id == id) {
            return Err("Breakpoint for given location already exists.".into());
        }
        let breakpoint = Rc::new(UrlBreakpoint {
            id: id.clone(),
            url: Query::new(url, None, Some(is_regexp)),
            position,
            options,
        });
        let locations: Vec<_> = (self.scripts.borrow().values())
            .filter_map(|script| self.apply_url_breakpoint(vm, &breakpoint, script))
            .map(Location::to_json)
            .collect();
        self.url_breakpoints.borrow_mut().push(breakpoint);
        Ok(object! { "breakpointId": id, "locations": locations })
    }

    pub(crate) fn set_breakpoint(
        &self,
        vm: &Vm,
        script: &Script,
        position: Position,
        options: Rc<Options>,
    ) -> Outcome {
        let id = breakpoint_id(script.id(), position);
        let location = (script.resolve(vm, position)).ok_or("Could not resolve breakpoint")?;
        self.add_breakpoint(vm, location, Some(id.clone()), options)
            .ok_or("Breakpoint for given location already exists")?;
        Ok(object! { "breakpointId": id, "actualLocation": location.to_json() })
    }

    pub(super) fn symbolic_breakpoint_for(
        &self,
        vm: &Vm,
        name: &StringRef,
    ) -> Option<Rc<Breakpoint>> {
        let breakpoints = self.symbolic_breakpoints.borrow();
        let found = breakpoints.iter().find(|it| it.matches(vm, name))?;
        (self.breakpoints_are_active()).then(|| Rc::clone(&found.breakpoint))
    }

    pub(crate) fn add_symbolic_breakpoint(
        &self,
        vm: &Vm,
        symbol: Query,
        breakpoint: Rc<Breakpoint>,
    ) -> Outcome<()> {
        let mut breakpoints = self.symbolic_breakpoints.borrow_mut();
        if breakpoints.iter().any(|it| it.symbol == symbol) {
            return Err("Symbolic breakpoint for given symbol, given caseSensitive, and given isRegex already exists".into());
        }
        breakpoints.push(SymbolicBreakpoint { symbol, breakpoint });
        drop(breakpoints);
        self.recount_requests(vm, None);
        vm.set_watches_native_calls(true);
        Ok(())
    }

    pub(crate) fn remove_symbolic_breakpoint(&self, vm: &Vm, symbol: &Query) -> Outcome<()> {
        let mut breakpoints = self.symbolic_breakpoints.borrow_mut();
        let index = breakpoints.iter().position(|it| it.symbol == *symbol);
        breakpoints.remove(index.ok_or(
            "Missing symbolic breakpoint for given symbol, given caseSensitive, and given isRegex",
        )?);
        vm.set_watches_native_calls(!breakpoints.is_empty());
        drop(breakpoints);
        self.recount_requests(vm, None);
        Ok(())
    }

    pub(super) fn apply_blackboxes(&self, vm: &Vm, script: &Script) {
        let mut ranges = Vec::new();
        for Blackbox { url, ranges: parts } in self.blackboxes.borrow().iter() {
            if url.matches(vm, script.source_url()) || url.matches(vm, script.url()) {
                ranges.extend(parts.is_empty().then(|| script.whole()));
                ranges.extend_from_slice(parts);
            }
        }
        script.blackboxed_ranges.replace(ranges);
    }

    /// Without ranges it is not blackboxed any more.
    pub(crate) fn set_blackbox(&self, vm: &Vm, url: Query, ranges: Option<Vec<Range<Position>>>) {
        let mut blackboxes = self.blackboxes.borrow_mut();
        blackboxes.retain(|it| it.url != url);
        blackboxes.extend(ranges.map(|ranges| Blackbox { url, ranges }));
        drop(blackboxes);
        for script in self.scripts.borrow().values() {
            self.apply_blackboxes(vm, script);
        }
    }

    pub(crate) fn request_pause(&self, vm: &Vm) {
        if !self.is_pause_requested.replace(true) {
            self.announce(Reason::PauseOnNextStatement, None);
            self.pause_at_next_opportunity(vm);
        }
    }

    fn cancel_pause_request(&self) {
        if self.is_pause_requested.take() {
            self.announce(Reason::Other, None);
            self.pauses_at_next_opportunity.set(false);
            self.pauses_when_idle.set(false);
        }
    }

    pub(crate) fn resume(&self, vm: &Vm) -> Outcome<()> {
        if self.paused_frame.get().is_none() && !self.is_pause_requested.get() {
            return Err("Must be paused or waiting to pause".into());
        }
        self.cancel_pause_request();
        self.continue_program();
        self.stop_stepping_if_done(vm);
        self.resumed.set(Resumed::WhenContinued);
        Ok(())
    }
}

impl Controller {
    /// `cx` is in the realm that is inspected, here and below.
    pub(crate) fn enable_debugger(&self, cx: &Cx) -> Outcome<()> {
        if self.debugger.is_enabled.replace(true) {
            return Err("Debugger domain already enabled".into());
        }
        let global = cx.global();
        global.set_debugger(cx, Some(Rc::new(Attachment(self.downgrade()))));
        self.update_instrumentation(cx);
        let (mut providers, mut wasm_modules) = (BTreeMap::new(), root_vec());
        cx.heap.for_each_live_cell(|cell| {
            if cell.cell_type() == CellType::WasmModule && cell.shape().global() == Some(global) {
                wasm_modules.push(cell);
            }
            let executable = match cell.downcast::<JsFunction>() {
                Some(function) => (function.script_executable())
                    .filter(|it| !it.is_builtin() && function.function_realm() == global)
                    .map(|it| it.upcast()),
                None => (cell.downcast::<ModuleExecutable>())
                    .filter(|it| it.global() == global)
                    .map(|it| it.upcast::<bun_engine_vm::ScriptExecutable>()),
            };
            if let Some(provider) = executable.as_ref().map(|it| it.provider()) {
                (providers.entry(provider.id())).or_insert_with(|| provider.clone());
            }
        });
        (providers.values()).for_each(|provider| self.did_parse(cx, provider, None));
        (wasm_modules.iter()).for_each(|&module| self.did_create_wasm_module(cx, module));
        Ok(())
    }

    pub(crate) fn disable_debugger(&self, cx: &Cx) {
        let debugger = &self.debugger;
        for breakpoint in debugger.breakpoints.take().values().flatten() {
            self.release_objects_of(cx, breakpoint);
        }
        debugger.url_breakpoints.take();
        debugger.destination.take();
        debugger.on_assertions.take();
        debugger.on_microtasks.take();
        if !debugger.symbolic_breakpoints.take().is_empty() {
            cx.set_watches_native_calls(false);
        }
        debugger.recount_requests(cx, None);
        if debugger.is_enabled.take() {
            cx.global().set_debugger(cx, None);
        }
        debugger.breakpoints_are_active.set(false);
        self.update_instrumentation(cx);
        debugger.scripts.take();
        debugger.failed_scripts.take();
        debugger.async_calls.clear();
        for start in debugger.microtasks.take().iter().filter_map(|it| it.start) {
            self.did_evaluate_script(start, ProfilingReason::Microtask);
        }
        debugger.cancel_pause_request();
        debugger.forget_suspension();
        debugger.continue_program();
        debugger.set_stepping(cx, false);
        debugger.announce(Reason::Other, None);
        if debugger.paused_frame.take().is_some() {
            self.notify_resumed();
        }
    }

    pub(crate) fn set_breakpoints_active(&self, cx: &Cx, are_active: bool) {
        self.debugger.breakpoints_are_active.set(are_active);
        self.update_instrumentation(cx);
    }

    fn update_instrumentation(&self, cx: &Cx) {
        let is_needed = self.debugger.is_enabled() && self.debugger.breakpoints_are_active();
        if cx.global().needs_debug_hooks().replace(is_needed) != is_needed {
            cx.discard_all_code();
        }
    }

    pub(super) fn apply_url_breakpoints(&self, vm: &Vm, script: &Script) {
        let breakpoints = self.debugger.url_breakpoints.borrow().clone();
        for breakpoint in breakpoints {
            if let Some(location) = self.debugger.apply_url_breakpoint(vm, &breakpoint, script) {
                let params =
                    object! { "breakpointId": &breakpoint.id, "location": location.to_json() };
                self.notify("Debugger.breakpointResolved", params);
            }
        }
    }

    fn release_objects_of(&self, vm: &Vm, breakpoint: &Breakpoint) {
        for action in &breakpoint.options.actions {
            self.registries.release_group(vm, &action.object_group());
        }
    }

    pub(crate) fn remove_breakpoint(&self, vm: &Vm, id: &StringRef) {
        let debugger = &self.debugger;
        (debugger.url_breakpoints.borrow_mut()).retain(|it| it.id != *id);
        for removed in debugger.remove_breakpoints(vm, |it| it.id.as_ref() == Some(id)) {
            self.release_objects_of(vm, &removed);
        }
    }

    pub(super) fn wait_for_idle(&self, vm: &Vm) {
        if !self.debugger.waits_for_idle.replace(true) {
            let controller = self.downgrade();
            vm.when_idle(move |vm| {
                if let Some(controller) = controller.upgrade() {
                    controller.did_become_idle(vm);
                }
            });
        }
    }

    fn did_become_idle(&self, vm: &Vm) {
        let debugger = &self.debugger;
        debugger.waits_for_idle.set(false);
        if debugger.resumed.take() == Resumed::WhenIdle {
            debugger.cancel_pause_request();
            debugger.continue_program();
            self.notify_resumed();
        }
        debugger.forget_target_frame();
        debugger.stop_stepping_if_done(vm);
        if debugger.pauses_when_idle.get() {
            debugger.request_pause(vm);
        }
    }

    /// It ends in `Debugger.paused`, or else in `Debugger.resumed`.
    fn will_step(&self, vm: &Vm) {
        self.debugger.resumed.set(Resumed::WhenIdle);
        self.wait_for_idle(vm);
    }

    pub(crate) fn step(&self, vm: &Vm, step: Step) -> Outcome<()> {
        let debugger = &self.debugger;
        let frame = debugger.check_paused()?;
        self.will_step(vm);
        let can_pause = |frame: usize| {
            let frame = vm.machine_frames().find(|it| it.address() == frame);
            (frame.and_then(|it| it.code_block())).is_some_and(|it| it.has_debug_hooks())
        };
        match step {
            Step::Into => debugger.pauses_at_next_opportunity.set(true),
            Step::Over | Step::Next if can_pause(frame) => {
                debugger.target_frame.set(frame);
                (debugger.pauses_at_expressions).set(matches!(step, Step::Next));
            }
            _ => {
                debugger.target_frame.set(caller_that_can_pause(vm, frame));
                debugger.pauses_at_expressions.set(true);
            }
        }
        debugger.set_stepping(vm, true);
        debugger.is_done_pausing.set(true);
        Ok(())
    }

    pub(crate) fn continue_until_next_run_loop(&self, vm: &Vm) -> Outcome<()> {
        self.debugger.check_paused()?;
        self.debugger.resume(vm)?;
        self.debugger.pauses_when_idle.set(true);
        self.wait_for_idle(vm);
        Ok(())
    }

    /// Resumes, whether it gets there or not.
    pub(crate) fn continue_to_location(&self, vm: &Vm, location: Location) -> Outcome<()> {
        let debugger = &self.debugger;
        let script = debugger.script(location.script);
        let resolved =
            (script.ok_or("Missing script for scriptId in given location")).and_then(|script| {
                (script.resolve(vm, location.position)).ok_or("Could not resolve breakpoint")
            });
        let destination =
            (resolved.ok()).and_then(|it| debugger.add_breakpoint(vm, it, None, Rc::default()));
        if destination.is_some() {
            self.will_step(vm);
        } else {
            self.notify_resumed();
        }
        debugger.destination.replace(destination);
        debugger.continue_program();
        Ok(resolved.map(drop)?)
    }
}
